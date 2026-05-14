import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import type { UppyFile, UploadResult } from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import AwsS3 from "@uppy/aws-s3";
import { Button } from "@/components/ui/button";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  /**
   * Function to get upload parameters for each file.
   * IMPORTANT: This receives the file object - use file.name, file.size, file.type
   * to request per-file presigned URLs from your backend.
   */
  onGetUploadParameters: (
    file: UppyFile<Record<string, unknown>, Record<string, unknown>>
  ) => Promise<{
    method: "PUT";
    url: string;
    headers?: Record<string, string>;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A file upload component that renders as a button and provides a modal interface for
 * file management.
 *
 * Features:
 * - Renders as a customizable button that opens a file upload modal
 * - Provides a modal interface for:
 *   - File selection
 *   - File preview
 *   - Upload progress tracking
 *   - Upload status display
 * - Guards against accidental closure mid-upload: closing the modal or navigating
 *   away while an upload is in progress shows a confirmation prompt.
 *
 * The component uses Uppy v5 under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
 *
 * @param props - Component props
 * @param props.maxNumberOfFiles - Maximum number of files allowed to be uploaded
 *   (default: 1)
 * @param props.maxFileSize - Maximum file size in bytes (default: 10MB)
 * @param props.onGetUploadParameters - Function to get upload parameters for each file.
 *   Receives the UppyFile object with file.name, file.size, file.type properties.
 *   Use these to request per-file presigned URLs from your backend. Returns method,
 *   url, and optional headers for the upload request.
 * @param props.onComplete - Callback function called when upload is complete. Typically
 *   used to make post-upload API calls to update server state and set object ACL
 *   policies.
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.children - Content to be rendered inside the button
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
      },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: onGetUploadParameters,
      })
      .on("complete", (result) => {
        onComplete?.(result);
      })
  );

  // Track upload state via Uppy events.
  useEffect(() => {
    const onUploadStart = () => setIsUploading(true);
    const onDone = () => setIsUploading(false);

    uppy.on("upload", onUploadStart);
    uppy.on("complete", onDone);
    uppy.on("upload-error", onDone);
    uppy.on("cancel-all", onDone);

    return () => {
      uppy.off("upload", onUploadStart);
      uppy.off("complete", onDone);
      uppy.off("upload-error", onDone);
      uppy.off("cancel-all", onDone);
    };
  }, [uppy]);

  // Warn before browser navigation / page refresh while an upload is in progress.
  useEffect(() => {
    if (!isUploading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isUploading]);

  // Guard the destroy call: if the component is unmounted while uploading,
  // cancel so the Uppy instance is left in a clean state.
  useEffect(() => {
    return () => {
      uppy.destroy();
    };
  }, [uppy]);

  // Close handler: requires confirmation when an upload is active.
  const handleRequestClose = useCallback(() => {
    if (isUploading) {
      const confirmed = window.confirm(
        "An upload is currently in progress. Closing will cancel it. Are you sure?"
      );
      if (!confirmed) return;
      uppy.cancelAll();
    }
    setShowModal(false);
  }, [isUploading, uppy]);

  return (
    <div>
      <Button
        onClick={() => setShowModal(true)}
        className={buttonClassName}
        data-testid="button-open-uploader"
      >
        {children}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={handleRequestClose}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
