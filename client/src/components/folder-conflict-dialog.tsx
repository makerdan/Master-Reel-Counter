import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Pencil, Hash, FolderInput } from "lucide-react";

export type ConflictResolution =
  | { type: "rename"; newName: string }
  | { type: "auto-number"; newName: string }
  | { type: "merge"; existingFolderId: number };

interface FolderConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictingName: string;
  autoNumberedName: string;
  existingFolderId: number;
  onResolve: (resolution: ConflictResolution) => void;
  isPending?: boolean;
  mode: "create" | "create-and-move";
}

export function FolderConflictDialog({
  open,
  onOpenChange,
  conflictingName,
  autoNumberedName,
  existingFolderId,
  onResolve,
  isPending = false,
  mode,
}: FolderConflictDialogProps) {
  const [renameValue, setRenameValue] = useState(conflictingName);
  const [selectedOption, setSelectedOption] = useState<
    "rename" | "auto-number" | "merge" | null
  >(null);

  useEffect(() => {
    if (open) {
      setRenameValue(conflictingName);
      setSelectedOption(null);
    }
  }, [open, conflictingName]);

  const handleConfirm = () => {
    if (!selectedOption) return;
    switch (selectedOption) {
      case "rename":
        onResolve({ type: "rename", newName: renameValue.trim() });
        break;
      case "auto-number":
        onResolve({ type: "auto-number", newName: autoNumberedName });
        break;
      case "merge":
        onResolve({ type: "merge", existingFolderId });
        break;
    }
  };

  const mergeDescription =
    mode === "create-and-move"
      ? "Move the session into the existing folder instead of creating a new one."
      : "Use the existing folder — no new folder will be created.";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelectedOption(null);
          setRenameValue(conflictingName);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md" data-testid="dialog-folder-conflict">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Folder Name Conflict
          </DialogTitle>
          <DialogDescription>
            A folder named "<span className="font-semibold">{conflictingName}</span>" already exists at this level. How would you like to proceed?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <button
            type="button"
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              selectedOption === "rename"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onClick={() => setSelectedOption("rename")}
            data-testid="option-rename"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <Pencil className="h-4 w-4" />
              Rename
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Choose a different name for the new folder.
            </p>
            {selectedOption === "rename" && (
              <div className="mt-2">
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="Enter a new name"
                  autoFocus
                  data-testid="input-rename-folder"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </button>

          <button
            type="button"
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              selectedOption === "auto-number"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onClick={() => setSelectedOption("auto-number")}
            data-testid="option-auto-number"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <Hash className="h-4 w-4" />
              Auto-number
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Create as "<span className="font-medium">{autoNumberedName}</span>" instead.
            </p>
          </button>

          <button
            type="button"
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              selectedOption === "merge"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onClick={() => setSelectedOption("merge")}
            data-testid="option-merge"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <FolderInput className="h-4 w-4" />
              Use existing folder
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {mergeDescription}
            </p>
          </button>

        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="button-cancel-conflict"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              !selectedOption ||
              isPending ||
              (selectedOption === "rename" && !renameValue.trim())
            }
            data-testid="button-confirm-conflict"
          >
            {isPending ? "Processing..." : "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
