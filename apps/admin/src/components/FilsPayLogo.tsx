import React from "react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  subtitle?: string;
  className?: string;
}

export function FilsPayLogo({ size = "md", subtitle = "Admin Console", className = "" }: LogoProps) {
  const iconSize = size === "sm" ? 26 : size === "lg" ? 44 : 34;
  const titleSize = size === "sm" ? "1.1rem" : size === "lg" ? "1.65rem" : "1.35rem";

  return (
    <div
      className={`filspay-brand-container ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.65rem",
        userSelect: "none",
        textDecoration: "none",
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          flexShrink: 0,
          filter: "drop-shadow(0 2px 4px rgba(26, 127, 55, 0.25))",
        }}
      >
        <rect width="48" height="48" rx="12" fill="#1A7F37" />
        <path
          d="M0 12C0 5.37258 5.37258 0 12 0H36C42.6274 0 48 5.37258 48 12V24L0 44V12Z"
          fill="white"
          fillOpacity="0.08"
        />
        <circle cx="24" cy="24" r="14" stroke="white" strokeWidth="2.5" strokeDasharray="3 3" opacity="0.6" />
        <path
          d="M16 15H32C33.1046 15 34 15.8954 34 17V17C34 18.1046 33.1046 19 32 19H21V23H29C30.1046 23 31 23.8954 31 25V25C31 26.1046 30.1046 27 29 27H21V33C21 34.1046 20.1046 35 19 35V35C17.8954 35 17 34.1046 17 33V16C17 15.4477 17.4477 15 18 15"
          fill="white"
        />
        <circle cx="31.5" cy="31.5" r="3.5" fill="#34D399" />
      </svg>

      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
          <span style={{ fontSize: titleSize, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.03em" }}>
            Fils
          </span>
          <span style={{ fontSize: titleSize, fontWeight: 800, color: "#1A7F37", letterSpacing: "-0.03em" }}>
            Pay
          </span>
        </div>
        {subtitle ? (
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#636366",
              marginTop: "2px",
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}

