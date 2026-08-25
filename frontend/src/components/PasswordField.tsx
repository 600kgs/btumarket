import { useState } from "react";
import { EyeOffIcon, EyeOpenIcon } from "./icons";

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  // When two password fields are linked (e.g. password + confirm password),
  // clicking either eye reveals both together, matching the old
  // addPasswordToggle(inputId, linkedIds) behavior - pass the same
  // shared `visible`/`onToggle` pair to both fields to link them.
  visible: boolean;
  onToggleVisible: () => void;
  autoComplete?: string;
}

export default function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  visible,
  onToggleVisible,
  autoComplete,
}: PasswordFieldProps) {
  return (
    <div className="password-field">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={onToggleVisible}
      >
        {visible ? <EyeOffIcon /> : <EyeOpenIcon />}
      </button>
    </div>
  );
}

// Shared visibility state for one or more linked PasswordFields.
export function usePasswordVisibility() {
  const [visible, setVisible] = useState(false);
  return { visible, onToggleVisible: () => setVisible((v) => !v) };
}
