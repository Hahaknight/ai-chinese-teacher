// 本服务在新流程中已被 essay.service.ts 的 processEssayTaskDirect 替代
// (直连 minimax,把图片作为 multimodal content 一次传给 AI,无需先 OCR 再调用)
// 仅在环境变量 MINIMAX_DIRECT=0 时被调用,作为已配 uvx + minimax-coding-plan-mcp 的环境保留路径
// TODO: 直连稳定后删除整个 MCP 子进程逻辑(预计 B 阶段第二刀)

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MCP_SERVER_SCRIPT = 'minimax-coding-plan-mcp';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, string>;
  };
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text?: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

class MCPProcess {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timeout: NodeJS.Timeout }>();
  private initTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Start the MCP server process using uvx
      this.process = spawn('uvx', [MCP_SERVER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdoutBuffer = '';
      let stderrOutput = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        this.processResponse(stdoutBuffer);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      this.process.on('error', (err) => {
        console.error('MCP process error:', err);
        reject(err);
      });

      this.process.on('exit', (code) => {
        console.log(`MCP process exited with code ${code}`);
        this.isInitialized = false;
      });

      // Initialize timeout (2 minutes)
      this.initTimeout = setTimeout(() => {
        this.kill();
        reject(new Error('MCP initialization timeout'));
      }, 120000);

      // Send initialize request
      const initPromise = this.sendRequest('initialize', {
        arguments: { api_key: ANTHROPIC_API_KEY }
      });

      initPromise.then((result) => {
        if (this.initTimeout) {
          clearTimeout(this.initTimeout);
          this.initTimeout = null;
        }
        this.isInitialized = true;
        resolve(result);
      }).catch(reject);

      // Also need to send "initialized" notification back
      setTimeout(() => {
        this.sendNotification('initialized', {});
      }, 1000);
    });
  }

  private processResponse(buffer: string) {
    const lines = buffer.split('\n');
    let remaining = '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: MCPResponse = JSON.parse(line);
        if (response.id) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response);
            }
          }
        }
      } catch {
        // Not complete JSON yet, keep buffering
        remaining = line;
      }
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP process not running'));
        return;
      }

      const id = this.requestId++;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('MCP request timeout'));
      }, 300000); // 5 minutes

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private sendNotification(method: string, params?: any) {
    if (!this.process?.stdin) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  async callTool(toolName: string, args: Record<string, string>): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const response = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });

    if (response.result?.content?.[0]?.text) {
      return response.result.content[0].text;
    }

    throw new Error('Invalid MCP response');
  }

  kill() {
    if (this.initTimeout) {
      clearTimeout(this.initTimeout);
    }
    this.pendingRequests.forEach(p => clearTimeout(p.timeout));
    this.pendingRequests.clear();

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isInitialized = false;
  }

  reset() {
    this.kill();
    setTimeout(() => this.initialize().catch(console.error), 1000);
  }
}

let mcpProcess: MCPProcess | null = null;
let mcpResetTimer: NodeJS.Timeout | null = null;

function getMCPProcess(): MCPProcess {
  if (!mcpProcess) {
    mcpProcess = new MCPProcess();
  }
  return mcpProcess;
}

export async function recognizeImage(imagePath: string, prompt: string = '识别图片中的文字，原文输出，不要修改。如果有段落请保留段落结构。'): Promise<string> {
  const mcp = getMCPProcess();

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`Image recognition attempt ${attempt}/5 for ${imagePath}`);
      const result = await mcp.callTool('understand_image', {
        prompt,
        image_source: imagePath
      });
      return result;
    } catch (error: any) {
      console.error(`Attempt ${attempt} failed:`, error.message);

      if (attempt < 5) {
        console.log(`Retrying in 30 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Reset MCP process
        mcp.reset();
      } else {
        throw new Error(`Image recognition failed after 5 attempts: ${error.message}`);
      }
    }
  }

  throw new Error('Image recognition failed');
}

export async function downloadImage(url: string, localPath: string): Promise<void> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(localPath, response.data);
}

export function cleanup() {
  if (mcpResetTimer) {
    clearTimeout(mcpResetTimer);
  }
  if (mcpProcess) {
    mcpProcess.kill();
  }
}