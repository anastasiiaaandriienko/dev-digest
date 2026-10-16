import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type CodeNode = { properties?: { className?: string[] }; children?: { value?: string }[] };

/** Text and `language-*` class of a fenced code block (hast: pre > code > text). */
function blockCode(node: unknown): { text: string; className?: string } {
  const code = (node as { children?: CodeNode[] })?.children?.[0];
  return {
    text: (code?.children ?? []).map((c) => c.value ?? "").join(""),
    className: code?.properties?.className?.join(" "),
  };
}

const heading = (fontSize: string, marginTop: number): React.CSSProperties => ({
  fontSize,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: "var(--text-primary)",
  margin: `${marginTop}px 0 8px`,
});

/**
 * Markdown renderer (replaces prototype mdLite). Inline + GFM. Block elements
 * get explicit styles because the global reset strips heading / list / pre
 * defaults (skill bodies use headings, lists and fenced examples).
 */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={heading("1.35em", 4)}>{children}</h1>,
          h2: ({ children }) => <h2 style={heading("1.15em", 14)}>{children}</h2>,
          h3: ({ children }) => <h3 style={heading("1.02em", 12)}>{children}</h3>,
          ul: ({ children }) => <ul style={{ margin: "0 0 10px", paddingLeft: 22, listStyle: "disc" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 10px", paddingLeft: 22, listStyle: "decimal" }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{ margin: "0 0 10px", padding: "2px 12px", borderLeft: "3px solid var(--border-strong)", color: "var(--text-secondary)" }}
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />,
          pre: ({ node }) => (
            <pre
              className="mono"
              style={{
                margin: "0 0 10px",
                padding: "10px 12px",
                borderRadius: 6,
                background: "var(--bg-hover)",
                fontSize: "0.88em",
                overflowX: "auto",
                whiteSpace: "pre",
              }}
            >
              <code className={blockCode(node).className}>{blockCode(node).text}</code>
            </pre>
          ),
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
