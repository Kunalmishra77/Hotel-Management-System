"use client";

/**
 * 27 owner-portal — document vault UI (FR-6/8). Mobile-first list with upload
 * (owner or staff-manager), authorized download links, and delete for documents
 * the caller is allowed to remove. The file is read client-side and sent
 * base64-encoded to the server action (same convention as ID scans).
 */
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { uploadOwnerDocument, deleteOwnerDocument } from "../document-actions";
import { DOC_CATEGORIES } from "../schema";
import type { OwnerDocumentItem } from "../queries";

const CATEGORY_LABEL: Record<string, string> = {
  AGREEMENT: "Agreement",
  LICENCE: "Licence",
  TAX: "Tax",
  STATEMENT: "Statement",
  OTHER: "Other",
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function DocumentVault({
  propertyId,
  documents,
  canUpload,
}: {
  propertyId: string;
  documents: OwnerDocumentItem[];
  canUpload: boolean;
}) {
  const [category, setCategory] = useState<string>("AGREEMENT");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  function upload() {
    if (!file) return toast.error("Choose a file to upload.");
    const finalTitle = title.trim() || file.name;
    start(async () => {
      const fileBase64 = await fileToBase64(file);
      const res = await uploadOwnerDocument({
        propertyId,
        category,
        title: finalTitle,
        contentType: file.type || "application/octet-stream",
        fileBase64,
      });
      if (res.ok) {
        toast.success("Document uploaded.");
        setTitle("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        location.reload();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteOwnerDocument({ documentId: id });
      if (res.ok) {
        toast.success("Document removed.");
        location.reload();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <div className="space-y-4">
      {canUpload ? (
        <div className="space-y-3 rounded-lg border p-4" data-testid="doc-upload">
          <h2 className="text-sm font-semibold">Upload a document</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="doc-category" className="text-xs text-muted-foreground">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="doc-category" data-testid="doc-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="doc-title" className="text-xs text-muted-foreground">Title (optional)</label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lease agreement 2026" maxLength={200} />
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            data-testid="doc-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
          />
          <Button onClick={upload} disabled={pending || !file} data-testid="doc-upload-btn">
            <Upload className="size-4" /> {pending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents yet" description="Uploaded documents appear here." />
      ) : (
        <ul className="space-y-2" data-testid="doc-list">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {CATEGORY_LABEL[doc.category] ?? doc.category} · {fmtSize(doc.sizeBytes)} ·{" "}
                  {doc.uploadedByRole === "OWNER" ? "You" : "Staff"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild variant="outline" size="sm">
                  <a href={`/owner/documents/${doc.id}`} data-testid="doc-download">
                    <Download className="size-4" />
                  </a>
                </Button>
                {doc.canDelete ? (
                  <Button variant="ghost" size="sm" onClick={() => remove(doc.id)} disabled={pending} aria-label="Delete document" data-testid="doc-delete">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
