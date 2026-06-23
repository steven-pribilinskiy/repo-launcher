import { forwardRef } from "react";
import { Search, X } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  isLoading: boolean;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, isLoading }, ref) => {
    return (
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700/50">
        <Search className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={isLoading ? "Loading repos..." : "Search repos..."}
          autoFocus
          className="w-full bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
          spellCheck={false}
          autoComplete="off"
        />
        {isLoading && (
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
        )}
        {!isLoading && value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Clear search (Esc)"
            aria-label="Clear search"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  },
);
