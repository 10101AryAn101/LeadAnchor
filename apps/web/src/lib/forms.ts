import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { isApiError } from "./api";

/** Puts the API's per-field validation messages onto the form; anything else becomes a toast. */
export function showFormError<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, error: unknown) {
  if (isApiError(error) && error.fields) {
    let placed = false;
    for (const [field, messages] of Object.entries(error.fields)) {
      if (field && field !== "_" && messages[0]) {
        form.setError(field as Path<T>, { message: messages[0] });
        placed = true;
      }
    }
    if (placed) return;
  }
  toast.error(isApiError(error) ? error.message : "Something went wrong. Please try again.");
}
