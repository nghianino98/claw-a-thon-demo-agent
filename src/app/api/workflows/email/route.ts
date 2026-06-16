import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireDidiAccess } from "@/lib/api/guard";

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflow_email" });
    if (!gate.ok) return gate.response;

    try {
        const { to, subject, resultText, workflowName } = await req.json();

        if (!to || !resultText) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
            return NextResponse.json({ error: "Email configuration is missing on the server." }, { status: 500 });
        }

        // Configure Nodemailer with Gmail SMTP
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.SMTP_EMAIL,
                pass: process.env.SMTP_PASSWORD, // Use an App Password for Gmail
            },
        });

        const mailOptions = {
            from: `"AI Workflow Builder" <${process.env.SMTP_EMAIL}>`,
            to,
            subject: subject || `Workflow Results: ${workflowName || "AI Process"}`,
            text: `Hello,\n\nHere are the results from your recent AI Workflow execution.\n\nWorkflow: ${workflowName}\n\n---\n\n${resultText}\n\n---\n\nPowered by AI Workflow Builder`,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("Message sent: %s", info.messageId);

        return NextResponse.json({ success: true, messageId: info.messageId });
    } catch (error: any) {
        console.error("Email Sending Error:", error);
        return NextResponse.json(
            { error: "Failed to send email", details: error.message },
            { status: 500 }
        );
    }
}
