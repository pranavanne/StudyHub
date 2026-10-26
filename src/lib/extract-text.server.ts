import { unzipSync, strFromU8 } from "fflate";

/** Strip XML tags from an Office XML part, keeping readable text. */
function xmlToText(xml: string, breakTags: RegExp): string {
  return xml
    .replace(breakTags, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    if (result.value.trim()) return result.value;
  } catch {
    // fall through to the XML reader below
  }
  const files = unzipSync(bytes);
  const part = files["word/document.xml"];
  if (!part) return "";
  return xmlToText(strFromU8(part), /<\/w:p>|<w:br\s*\/>/g);
}

function extractPptx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const num = (value: string) => Number(value.match(/(\d+)\.xml$/)?.[1] ?? 0);
      return num(a) - num(b);
    });

  const parts: string[] = [];
  for (const name of slides) {
    const part = files[name];
    if (!part) continue;
    const text = xmlToText(strFromU8(part), /<\/a:p>|<a:br\s*\/>/g);
    const notesName = name.replace("ppt/slides/slide", "ppt/notesSlides/notesSlide");
    const notes = files[notesName];
    const noteText = notes ? xmlToText(strFromU8(notes), /<\/a:p>/g) : "";
    const index = parts.length + 1;
    if (text || noteText) {
      parts.push(
        [`Slide ${index}`, text, noteText ? `Speaker notes: ${noteText}` : ""]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}

/** Read raw text out of a PDF, Word (.docx) or PowerPoint (.pptx) file. */
export async function extractDocumentText(bytes: Uint8Array, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes);
    case "doc":
    case "ppt":
      throw new Error(
        "Older Word/PowerPoint files (.doc, .ppt) can't be read. Save the file as .docx or .pptx and upload it again.",
      );
    default:
      throw new Error("Unsupported file type. Upload a PDF, Word (.docx) or PowerPoint (.pptx).");
  }
}
