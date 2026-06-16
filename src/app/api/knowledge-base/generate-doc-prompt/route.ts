import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireDidiAccess } from "@/lib/api/guard";

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "generate_doc_prompt" });
    if (!gate.ok) return gate.response;

    try {
        const { text, modelSelection } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "Missing text payload" }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
        const model = genAI.getGenerativeModel({ model: modelSelection || 'gemini-2.5-flash' });

        const prompt = `Bạn là một chuyên gia soạn thảo văn bản. Dựa vào nội dung tài liệu sau đây, hãy viết 1 ĐOẠN PROMPT NGẮN (khoảng 2-3 câu bằng tiếng Việt) để người dùng dán vào Google Docs (hoặc đưa cho một AI chỉnh sửa văn bản khác) nhằm tự động định dạng lại đoạn nội dung này cho đẹp mắt và chuẩn xác nhất.\n\nVí dụ: "Hãy định dạng lại văn bản này thành hệ thống báo cáo chuẩn: Font Arial cỡ 11, dãn dòng 1.5. Các thẻ H2 bôi đậm màu xanh, bôi đỏ các cảnh báo lỗi. Căn lề đều 2 bên."\n\nBạn hãy phân tích chính tài liệu được cung cấp để gợi ý Định dạng màu sắc, Font, Spacing, kích cỡ phù hợp nhất với ngữ cảnh của nó (Ví dụ: báo cáo tài chính thì cần bảng biểu/số liệu rõ ràng, kịch bản thì cần in nghiêng lời thoại...).\n\nTUYỆT ĐỐI CHỈ TRẢ VỀ ĐOẠN CHỈ DẪN PROMPT, KHÔNG GIẢI THÍCH GÌ THÊM.\n\nDữ liệu nguồn:\n${text.substring(0, 5000)}`;

        const result = await model.generateContent(prompt);
        let docPrompt = result.response.text().trim();

        return NextResponse.json({ docPrompt });

    } catch (error: any) {
        console.error("Doc Prompt generation error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
