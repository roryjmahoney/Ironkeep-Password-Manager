// Adapted from Origin UI's 21st.dev show/hide password input:
// https://21st.dev/community/components/originui/input/show-hide-password-input
import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { Input } from "./Input.js";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  helperText?: string;
}

export function PasswordInput({ label, helperText, id: providedId, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const [isVisible, setIsVisible] = useState(false);
  const helperId = helperText ? `${id}-helper` : undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          className="pe-11"
          type={isVisible ? "text" : "password"}
          aria-describedby={helperId}
          {...props}
        />
        <button
          className="absolute inset-y-0 end-0 flex h-full w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? "Hide master password" : "Show master password"}
          aria-pressed={isVisible}
          aria-controls={id}
        >
          {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {helperText ? <p id={helperId} className="text-xs leading-5 text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}
