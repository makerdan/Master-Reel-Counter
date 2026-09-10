import { useState, useCallback } from "react";

export interface UploadResponse {
  objectPath: string;
  metadata: {
    name: string;
    size: number;
    contentType: string;
  };
}

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

export type UploadResult =
  | { success: true; data: UploadResponse }
  | { success: false; data: null; networkError: boolean; error: Error };

export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResult> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        setProgress(10);
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/uploads/direct", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to upload file");
        }

        setProgress(100);
        const result: UploadResponse = await response.json();
        options.onSuccess?.(result);
        return { success: true, data: result };
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed");
        const networkError =
          error.message === "Failed to fetch" ||
          error.message === "Load failed" ||
          error.message === "NetworkError when attempting to fetch resource." ||
          !navigator.onLine;
        setError(error);
        options.onError?.(error);
        return { success: false, data: null, networkError, error };
      } finally {
        setIsUploading(false);
      }
    },
    [options]
  );

  return {
    uploadFile,
    isUploading,
    error,
    progress,
  };
}
