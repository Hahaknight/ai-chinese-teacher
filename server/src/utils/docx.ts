import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import { v4 as uuidv4 } from 'uuid';

export interface EssayReportData {
  studentName: string;
  batchName: string;
  reviewRequirement: string;
  recognizedText: string;
  score: {
    total: number;
    fullScore: number;
    summary: string;
    items: Array<{
      name: string;
      score: number;
      fullScore: number;
      comment: string;
    }>;
  };
  overallComment: string;
  highlights: string[];
  problems: string[];
  suggestions: string[];
  improvedEssay: string;
  shortTeacherComment: string;
}

export async function generateEssayReportDocx(data: EssayReportData): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4: 210mm x 297mm in twips (1mm = 56.7twips)
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: '作文批改报告', bold: true, size: 36 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        }),

        // Section 1: Basic Info
        new Paragraph({ children: [new TextRun({ text: '一、基础信息', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: `学生姓名：${data.studentName}`, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: `批次名称：${data.batchName}`, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: `批改要求：${data.reviewRequirement}`, size: 24 })] }),

        // Section 2: Recognized Text
        new Paragraph({ children: [new TextRun({ text: '二、识别出的作文原文', bold: true, size: 28 })], spacing: { before: 600, after: 200 } }),
        new Paragraph({
          children: [new TextRun({ text: data.recognizedText || '（未识别到作文内容）', size: 24 })],
          spacing: { line: 360 }
        }),

        // Section 3: Score
        new Paragraph({ children: [new TextRun({ text: '三、作文评分', bold: true, size: 28 })], spacing: { before: 600, after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: `总分：${data.score.total} / ${data.score.fullScore}`, size: 24 })] }),

        // Score table
        new Table({
          width: { size: 100, type: 'pct' },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '评分项', bold: true, size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '得分', bold: true, size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '满分', bold: true, size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '评价', bold: true, size: 22 })] })] })
              ]
            }),
            ...data.score.items.map(item => new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.name, size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(item.score), size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(item.fullScore), size: 22 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.comment, size: 22 })] })] })
              ]
            }))
          ]
        }),

        // Section 4: Overall Comment
        new Paragraph({ children: [new TextRun({ text: '四、作文总评', bold: true, size: 28 })], spacing: { before: 600, after: 200 } }),
        new Paragraph({
          children: [new TextRun({ text: data.overallComment, size: 24 })],
          spacing: { line: 360 }
        }),

        // Section 5: Highlights
        new Paragraph({ children: [new TextRun({ text: '五、作文亮点', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.highlights.map(h => new Paragraph({
          children: [new TextRun({ text: `• ${h}`, size: 24 })],
          spacing: { line: 300 }
        })),

        // Section 6: Problems
        new Paragraph({ children: [new TextRun({ text: '六、主要问题', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.problems.map(p => new Paragraph({
          children: [new TextRun({ text: `• ${p}`, size: 24 })],
          spacing: { line: 300 }
        })),

        // Section 7: Suggestions
        new Paragraph({ children: [new TextRun({ text: '七、修改建议', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.suggestions.map(s => new Paragraph({
          children: [new TextRun({ text: `• ${s}`, size: 24 })],
          spacing: { line: 300 }
        })),

        // Section 8: Improved Essay
        new Paragraph({ children: [new TextRun({ text: '八、改良后的作文', bold: true, size: 28 })], spacing: { before: 600, after: 200 } }),
        new Paragraph({
          children: [new TextRun({ text: data.improvedEssay, size: 24 })],
          spacing: { line: 360 }
        }),

        // Section 9: Short Comment
        new Paragraph({ children: [new TextRun({ text: '九、教师简短评语', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        new Paragraph({
          children: [new TextRun({ text: data.shortTeacherComment, size: 24, bold: true })]
        })
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

export interface LectureReviewData {
  title: string;
  overallSituation: string;
  mainStrengths: string[];
  commonProblems: string[];
  typicalProblemExplanation: Array<{
    problem: string;
    reason: string;
    method: string;
  }>;
  excellentExpressions: string[];
  classPractice: Array<{
    exercise: string;
    guide: string;
    answer: string;
  }>;
  afterClassSuggestions: string[];
}

export async function generateLectureReviewDocx(data: LectureReviewData, batchName: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: '作文讲评课方案', bold: true, size: 36 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        }),
        new Paragraph({
          children: [new TextRun({ text: `《${batchName}》`, size: 28 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 }
        }),

        // Section 1
        new Paragraph({ children: [new TextRun({ text: '一、本次作文整体情况', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        new Paragraph({
          children: [new TextRun({ text: data.overallSituation, size: 24 })],
          spacing: { line: 360 }
        }),

        // Section 2
        new Paragraph({ children: [new TextRun({ text: '二、本次作文主要优点', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.mainStrengths.map(s => new Paragraph({
          children: [new TextRun({ text: `• ${s}`, size: 24 })],
          spacing: { line: 300 }
        })),

        // Section 3
        new Paragraph({ children: [new TextRun({ text: '三、本次作文共性问题', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.commonProblems.map(p => new Paragraph({
          children: [new TextRun({ text: `• ${p}`, size: 24 })],
          spacing: { line: 300 }
        })),

        // Section 4
        new Paragraph({ children: [new TextRun({ text: '四、典型问题讲解', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.typicalProblemExplanation.map(t => new Paragraph({
          children: [
            new TextRun({ text: `问题：${t.problem}`, size: 24, bold: true }),
            new TextRun({ text: `\n原因：${t.reason}`, size: 24 }),
            new TextRun({ text: `\n方法：${t.method}`, size: 24 })
          ],
          spacing: { line: 360 }
        })),

        // Section 5
        new Paragraph({ children: [new TextRun({ text: '五、优秀表达赏析', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.excellentExpressions.map(e => new Paragraph({
          children: [new TextRun({ text: `【示例】\n${e}`, size: 24 })],
          spacing: { line: 360 }
        })),

        // Section 6
        new Paragraph({ children: [new TextRun({ text: '六、课堂修改练习', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.classPractice.map(p => new Paragraph({
          children: [
            new TextRun({ text: `【练习】\n${p.exercise}`, size: 24, bold: true }),
            new TextRun({ text: `\n【引导】${p.guide}`, size: 24 }),
            new TextRun({ text: `\n【参考答案】${p.answer}`, size: 24 })
          ],
          spacing: { line: 360 }
        })),

        // Section 7
        new Paragraph({ children: [new TextRun({ text: '七、课后提升建议', bold: true, size: 28 })], spacing: { before: 400, after: 200 } }),
        ...data.afterClassSuggestions.map(s => new Paragraph({
          children: [new TextRun({ text: `• ${s}`, size: 24 })],
          spacing: { line: 300 }
        }))
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}