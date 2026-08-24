// Adapted from Origin UI's 21st.dev search input with keyboard hint:
// https://21st.dev/community/components/originui/input/search-input-with-kbd
import { Search } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { Input } from "./Input.js";

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SearchInput(props, ref) {
  const id = useId();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground" size={17} aria-hidden="true" />
      <Input ref={ref} id={id} className="h-10 ps-10 pe-14" type="search" aria-label="Search vault" {...props} />
      <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2 text-muted-foreground">
        <kbd className="inline-flex h-5 items-center border border-line bg-subtle px-1.5 font-sans text-[10px] font-semibold uppercase tracking-wide">
          Ctrl K
        </kbd>
      </div>
    </div>
  );
});
