import "../../../assets/logo.css";
import mark from "../../../assets/logo.svg?raw";

// trakarr's mark, shared with the landing page: see assets/README.md. The SVG
// goes inline so logo.css can animate its parts.
export function Logo({ className }: { className?: string }) {
  return <span className={`inline-flex [&>svg]:size-full ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: mark }} />;
}
