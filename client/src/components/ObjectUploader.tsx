import { useState, useEffect, useCallback, useRef } from "react";
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
 * - Guards against accidental closure mid-upload:
 *   - Closing the modal while uploading requires a confirmation prompt.
 *   - Full-page navigation (refresh/unload) while uploading triggers the
 *     browser's built-in "Leave site?" dialog.
 *   - React component unmount while uploading defers Uppy teardown until
 *     the in-flight HTTP request completes, so uploads are never silently lost.
 *
 * The component uses Uppy v5 under the hood to handle all file upload functionality.
 * All file management features are automatically handled by the Uppy dashboard modal.
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

  // Keep a stable ref to the latest onComplete callback so the Uppy "complete"
  // listener (attached once at creation) always invokes the current prop value.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Ref mirrors isUploading state so the unmount cleanup can read the current
  // value without capturing a stale closure.
  const isUploadingRef = useRef(false);

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
        onCompleteRef.current?.(result);
      })
  );

  // Track upload state via Uppy events; keep ref in sync with state.
  useEffect(() => {
    const onUploadStart = () => {
      setIsUploading(true);
      isUploadingRef.current = true;
    };
    const onDone = () => {
      setIsUploading(false);
      isUploadingRef.current = false;
    };

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

  // Teardown: if an upload is active when the component unmounts (e.g. in-app
  // navigation), defer Uppy destruction until the in-flight request settles so
  // uploads are never silently discarded. If idle, destroy immediately.
  useEffect(() => {
    return () => {
      if (isUploadingRef.current) {
        const destroyOnDone = () => { uppy.destroy(); };
        uppy.once("complete", destroyOnDone);
        uppy.once("upload-error", destroyOnDone);
        uppy.once("cancel-all", destroyOnDone);
      } else {
        uppy.destroy();
      }
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
