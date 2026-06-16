import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireDidiAccess } from "@/lib/api/guard";

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "generate_diagram" });
    if (!gate.ok) return gate.response;

    try {
        const { text, modelSelection } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "Missing text payload" }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
        const model = genAI.getGenerativeModel({ model: modelSelection || 'gemini-2.5-flash' });

        const prompt = `Bạn là chuyên gia phân tích hệ thống. Dựa vào nội dung tài liệu sau đây, hãy viết ra MỘT cấu trúc sơ đồ Mermaid (Mermaid.js) thể hiện luồng làm việc, kiến trúc hoặc quan hệ giữa các thực thể.\n\nTUYỆT ĐỐI CHỈ TRẢ VỀ ĐOẠN CODE MERMAID THUẦN (KHÔNG BỌC TRONG \`\`\`mermaid...\`\`\`, KHÔNG BỌC TRONG BẤT KỲ MARKDOWN NÀO, KHÔNG GIẢI THÍCH GÌ THÊM).\n\nQUY TẮC CÚ PHÁP BẮT BUỘC:\n1. MỌI text hiển thị bên trong Node mà có CHỨA KHOẢNG TRẮNG, DẤU NGOẶC, HOẶC KÝ TỰ ĐẶC BIỆT THÌ BẮT BUỘC PHẢI ĐẶT TRONG DẤU NGOẶC KÉP "". KHÔNG BAO GIỜ để trần.\n2. KHÔNG DÙNG ký tự xuống dòng (\\n) bên trong text của Node.\n\nVí dụ format đúng:\ngraph TD\n  A["Bắt đầu (Start)"] --> B("Xử lý dữ liệu")\n  B --> C{"Quyết định?"}\n\nDữ liệu nguồn:\n${text.substring(0, 5000)}`;

        const result = await model.generateContent(prompt);
        let diagramCode = result.response.text().trim();

        // Extract mermaid code block if it exists
        const match = diagramCode.match(/```(?:mermaid)?\n?([\s\S]*?)\n?```/);
        if (match) {
            diagramCode = match[1].trim();
        } else {
            // Remove any starting/ending triple backticks just in case
            diagramCode = diagramCode.replace(/^```(?:mermaid)?\n?/, '').replace(/\n?```$/, '').trim();
        }

        // Clean up unquoted strings inside Mermaid nodes (which crash the parser)
        // Convert `A[Some text (with parens)]` into `A["Some text (with parens)"]`
        diagramCode = diagramCode
            .replace(/([A-Za-z0-9_]+)\[([^\[\]]+)\]/g, (match, id, text) => text.trim().startsWith('"') ? match : `${id}["${text.trim()}"]`)
            .replace(/([A-Za-z0-9_]+)\(([^()]+)\)/g, (match, id, text) => text.trim().startsWith('"') ? match : `${id}("${text.trim()}")`)
            .replace(/([A-Za-z0-9_]+)\{([^{}]+)\}/g, (match, id, text) => text.trim().startsWith('"') ? match : `${id}{"${text.trim()}"}`);

        return NextResponse.json({ diagramCode });

    } catch (error: any) {
        console.error("Diagram generation error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
