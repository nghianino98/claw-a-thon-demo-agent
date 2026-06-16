import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from 'fs/promises';
import path from 'path';
// @ts-ignore
import PDFParser from "pdf2json";
import { parse } from "csv-parse/sync";
import { requireDidiAccess } from "@/lib/api/guard";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function stateDir() {
    return process.env.STATE_DIR || path.join(process.cwd(), 'data');
}

export async function POST(req: NextRequest) {
    const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflow_execute" });
    if (!gate.ok) return gate.response;

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const filePath = formData.get("filePath") as string | null;
        const promptTemplate = formData.get("prompt") as string;

        if (!file && !filePath) {
            return NextResponse.json({ error: "No file or file path provided" }, { status: 400 });
        }

        if (!promptTemplate) {
            return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
        }

        let extractedText = "";
        let finalFileName = "";

        const extractTextFromBuffer = async (buf: Buffer, fType: string, fName: string) => {
            if (fType === "application/pdf" || fName.endsWith(".pdf")) {
                return await new Promise<string>((resolve, reject) => {
                    const pdfParser = new PDFParser(null, true);
                    pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
                    pdfParser.on("pdfParser_dataReady", () => {
                        resolve(pdfParser.getRawTextContent());
                    });
                    pdfParser.parseBuffer(buf);
                });
            } else if (fType === "text/csv" || fName.endsWith(".csv")) {
                const records = parse(buf.toString('utf8'), { columns: true, skip_empty_lines: true });
                return JSON.stringify(records, null, 2);
            } else if (fType.startsWith("text/") || fName.endsWith(".txt") || fName.endsWith(".md")) {
                return buf.toString('utf8');
            } else {
                throw new Error("Unsupported file type: " + fType);
            }
        };

        if (file) {
            const buffer = Buffer.from(await file.arrayBuffer());
            extractedText = await extractTextFromBuffer(buffer, file.type, file.name);
            finalFileName = file.name;
        } else if (filePath) {
            let targetPaths: string[] = [];

            try {
                const stat = await fs.stat(filePath);
                if (stat.isFile()) targetPaths = [filePath];
            } catch {
                // Not a direct absolute file. 
                // Is it a directory path + pattern?
                const dirName = path.dirname(filePath);
                const baseName = path.basename(filePath);
                const ext = path.extname(baseName).toLowerCase();
                const searchPattern = path.basename(baseName, ext).toLowerCase(); // strictly the name part

                const os = require('os');
                const searchDirs = [
                    dirName !== '.' ? dirName : null, // If they provided an absolute dir prefix
                    process.cwd(),
                    stateDir(),
                    path.join(os.homedir(), 'Downloads'),
                    path.join(os.homedir(), 'Desktop'),
                    path.join(os.homedir(), 'Documents')
                ].filter(Boolean) as string[];

                for (const dir of searchDirs) {
                    try {
                        const files = await fs.readdir(dir);
                        const matches = files.filter(f => {
                            const fLower = f.toLowerCase();
                            return fLower.includes(searchPattern) && (ext ? fLower.endsWith(ext) : true);
                        });

                        if (matches.length > 0) {
                            targetPaths = matches.map(m => path.join(dir, m));
                            console.log(`Found ${matches.length} matching files in ${dir}`);
                            break; // Stop searching other directories once we find matches
                        }
                    } catch (e) {
                        // ignore empty/unreadable dirs
                    }
                }
            }

            if (targetPaths.length === 0) {
                return NextResponse.json({ error: `Could not find any files matching: ${filePath}` }, { status: 400 });
            }

            // Extract text from all matched files
            try {
                const texts = [];
                for (const targetPath of targetPaths) {
                    const buf = await fs.readFile(targetPath);
                    const ext = path.extname(targetPath).toLowerCase();
                    let fType = "text/plain";
                    if (ext === '.pdf') fType = "application/pdf";
                    else if (ext === '.csv') fType = "text/csv";

                    const text = await extractTextFromBuffer(buf, fType, path.basename(targetPath));
                    texts.push(`--- File: ${path.basename(targetPath)} ---\n${text}`);
                }
                extractedText = texts.join("\n\n");
                finalFileName = targetPaths.length === 1 ? path.basename(targetPaths[0]) : `${targetPaths.length} files matched`;
            } catch (err: any) {
                console.error("Error extracting text from local files:", err);
                return NextResponse.json({ error: err.message || `Could not read local files` }, { status: 400 });
            }
        }

        if (!extractedText || extractedText.trim() === "") {
            return NextResponse.json({ error: "No text could be extracted from the file" }, { status: 400 });
        }

        // 2. Prepare Prompt
        const finalPrompt = promptTemplate.replace("{{text}}", extractedText);

        const modelSelection = formData.get("model") as string || "gemini-2.5-flash";

        // 3. Call Gemini
        const model = genAI.getGenerativeModel({ model: modelSelection });

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();

        // 4. Return Output
        return NextResponse.json({
            success: true,
            result: text,
            fileName: finalFileName
        });

    } catch (error: any) {
        console.error("Workflow Execution Error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to execute workflow", details: error?.toString() },
            { status: 400 } // Send as 400 so the client can read the JSON body for the actual message
        );
    }
}
