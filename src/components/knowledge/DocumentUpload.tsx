import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Upload,
  FileText,
  Loader2,
  Trash2,
  CheckCircle,
  AlertCircle,
  File,
  RefreshCw,
} from 'lucide-react';

interface DocumentUploadProps {
  workspaceId: string;
  onDocumentProcessed?: () => void;
}

interface Document {
  id: string;
  name: string;
  file_type: string;
  file_size: number | null;
  status: string;
  page_count: number | null;
  processed_at: string | null;
  created_at: string;
}

export const DocumentUpload = ({ workspaceId, onDocumentProcessed }: DocumentUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, file_type, file_size, status, page_count, processed_at, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (e) {
      console.error('Error fetching documents:', e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
    ];
    const allowedExtensions = ['pdf', 'txt', 'md', 'csv', 'json'];
    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExt || '')) {
      toast.error('Supported formats: PDF, TXT, MD, CSV, JSON');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      // 10MB limit
      toast.error('File size must be under 10MB');
      return;
    }

    setUploading(true);
    try {
      // Upload to storage
      const filePath = `${workspaceId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create document record
      const { data: doc, error: insertError } = await supabase
        .from('documents')
        .insert({
          workspace_id: workspaceId,
          name: file.name,
          file_path: filePath,
          file_type: fileExt || file.type.split('/').pop() || 'unknown',
          file_size: file.size,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      toast.success('Document uploaded! Processing...');
      setDocuments((prev) => [doc as Document, ...prev]);

      // Trigger processing
      await processDocument(doc.id);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const processDocument = async (documentId: string) => {
    setProcessing(documentId);
    try {
      // Process document (chunk and embed)
      const { data: processData, error: processError } = await supabase.functions.invoke(
        'document-process',
        {
          body: { workspace_id: workspaceId, document_id: documentId, action: 'process' },
        },
      );

      if (processError) throw processError;

      // Extract FAQs
      const { data: faqData, error: faqError } = await supabase.functions.invoke(
        'document-process',
        {
          body: { workspace_id: workspaceId, document_id: documentId, action: 'extract_faqs' },
        },
      );

      if (faqError) {
        console.warn('FAQ extraction failed:', faqError);
      }

      toast.success(`Document processed! ${faqData?.faqs_extracted || 0} FAQs extracted.`);
      onDocumentProcessed?.();
      fetchDocuments();
    } catch (e: any) {
      toast.error(e.message || 'Processing failed');
      // Update status to failed
      await supabase
        .from('documents')
        .update({ status: 'failed', error_message: e.message })
        .eq('id', documentId);
      fetchDocuments();
    } finally {
      setProcessing(null);
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      const { error } = await supabase.functions.invoke('document-process', {
        body: { workspace_id: workspaceId, document_id: documentId, action: 'delete' },
      });

      if (error) throw error;

      toast.success('Document deleted');
      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="h-3 w-3 mr-1" />
            Processed
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload Documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Area */}
        <label className="relative block cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept=".pdf,.txt,.md,.csv,.json"
            onChange={handleUpload}
            disabled={uploading || !!processing}
          />
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 hover:border-primary/50 hover:bg-muted/50 transition-colors">
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">
                {uploading ? 'Uploading...' : 'Click to upload document'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, TXT, MD, CSV, JSON (max 10MB)
              </p>
            </div>
          </div>
        </label>

        {/* Documents List */}
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Uploaded Documents
            </p>
            <div className="divide-y rounded-lg border">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <File className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(doc.file_size)} • {doc.page_count || 0} chunks
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {getStatusBadge(processing === doc.id ? 'processing' : doc.status)}
                    {doc.status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => processDocument(doc.id)}
                        disabled={!!processing}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteDocument(doc.id)}
                      disabled={processing === doc.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground py-4">
            No documents uploaded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
};
