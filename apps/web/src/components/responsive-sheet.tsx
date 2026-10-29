"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet on phones (swipe or Back to close, with a visible close control),
 * dialog on larger screens. Used for move, edit and compose — never stacked.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent className={cn("max-h-[88dvh]", className)}>
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-lg font-bold">{title}</DrawerTitle>
            {description && <DrawerDescription className="text-[15px]">{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="overflow-y-auto overscroll-contain px-4 pb-2">{children}</div>
          {footer && <DrawerFooter className="pb-safe">{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-md", className)}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          {description && <DialogDescription className="text-[15px]">{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
