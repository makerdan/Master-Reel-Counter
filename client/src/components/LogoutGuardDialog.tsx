import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface LogoutGuardDialogProps {
  pendingCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function LogoutGuardDialog({
  pendingCount,
  open,
  onOpenChange,
  onConfirm,
}: LogoutGuardDialogProps) {
  const itemLabel = pendingCount === 1 ? "item" : "items";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-logout-guard">
        <AlertDialogHeader>
          <AlertDialogTitle>You have unsynced items</AlertDialogTitle>
          <AlertDialogDescription>
            You have {pendingCount} {itemLabel} waiting to sync. They will be
            preserved and uploaded automatically when you log back in and
            reconnect. To sync now, stay on the page until the upload completes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-logout-guard-cancel">
            Stay and sync
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="button-logout-guard-confirm"
          >
            Sign out anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
