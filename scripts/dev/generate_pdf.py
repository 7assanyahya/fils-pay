import os
import re
import base64
import subprocess
import markdown

WORKSPACE = "/Users/macbookpro2019/fils-pay"
SUBMISSION_MD = os.path.join(WORKSPACE, "docs/SUBMISSION.md")
OUTPUT_HTML = "/tmp/submission_rendered.html"
OUTPUT_PDF = os.path.join(WORKSPACE, "HitTheRoad_FilsPay_Submission.pdf")

def image_to_base64(path):
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE, path)
    if os.path.exists(path):
        ext = os.path.splitext(path)[1].lower().replace(".", "")
        mime = "image/png" if ext == "png" else "image/jpeg"
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
            return f"data:{mime};base64,{b64}"
    return None

def main():
    with open(SUBMISSION_MD, "r", encoding="utf-8") as f:
        md_text = f.read()

    # Pre-process Mermaid diagrams: change ```mermaid ... ``` to <div class="mermaid">...</div>
    def replace_mermaid(match):
        diagram = match.group(1).strip()
        return f'<div class="mermaid">\n{diagram}\n</div>'

    md_text = re.sub(r'```mermaid\s*\n(.*?)\n```', replace_mermaid, md_text, flags=re.DOTALL)

    # Convert markdown to HTML
    html_content = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "nl2br", "sane_lists"]
    )

    # Convert before/after links into side-by-side visual image comparison boxes
    def replace_comparison(match):
        before_file = match.group(1)
        after_file = match.group(2)
        b64_before = image_to_base64(before_file)
        b64_after = image_to_base64(after_file)
        if b64_before and b64_after:
            return f'''
            <div class="comparison-grid">
                <div class="comparison-card">
                    <div class="badge-before">BEFORE</div>
                    <img src="{b64_before}" alt="Before" class="comp-img" />
                    <div class="comp-filename">{os.path.basename(before_file)}</div>
                </div>
                <div class="comparison-card">
                    <div class="badge-after">AFTER</div>
                    <img src="{b64_after}" alt="After" class="comp-img" />
                    <div class="comp-filename">{os.path.basename(after_file)}</div>
                </div>
            </div>
            '''
        return match.group(0)

    # Match Evidence lines with before and after links
    # Pattern: Evidence: <a href="...before...">...</a> &rarr; <a href="...after...">...</a>
    html_content = re.sub(
        r'Evidence:\s*<a href="[^"]*?(docs/screenshots/[^"]+before\.[a-z]+)[^"]*">[^<]+</a>\s*(?:&rarr;|→)\s*<a href="[^"]*?(docs/screenshots/[^"]+after\.[a-z]+)[^"]*">[^<]+</a>',
        replace_comparison,
        html_content,
        flags=re.IGNORECASE
    )

    # Add page breaks to major numbered section h1s
    html_content = re.sub(r'<h1>(\d+\..*?)</h1>', r'<h1 class="section-break">\1</h1>', html_content)
    html_content = re.sub(r'<h1>(Appendix.*?)</h1>', r'<h1 class="section-break">\1</h1>', html_content)

    # Format Cover page nicely
    cover_html = """
    <div class="cover-container">
        <div class="cover-header">
            <div class="cover-logo">
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                    <rect width="32" height="32" rx="7" fill="#1A7F37"/>
                    <path d="M7 10h18M7 16h13M7 22h8" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
                    <circle cx="23" cy="20" r="4.5" fill="#2DA44E" stroke="#ffffff" stroke-width="1.5"/>
                    <path d="M21.5 20l1 1 2-2" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="cover-logo-text">FilsPay</span>
            </div>
            <span class="cover-badge">COMPETITION SUBMISSION</span>
        </div>
        
        <h1 class="cover-main-title">Codebase Remediation & Architecture Audit</h1>
        <p class="cover-sub-title">170-Point Master Rubric Submission — Full-Stack Financial Engineering, Concurrency & Security Hardening</p>

        <div class="meta-section">
            <div class="meta-card">
                <div class="meta-card-title">Team Information</div>
                <div class="meta-row"><strong>Team Name:</strong> Hit The Road</div>
                <div class="meta-row"><strong>1. Hasan Yahya:</strong> Lead Full-Stack Engineering, Cloud Infrastructure & Systems Architecture</div>
                <div class="meta-row"><strong>2. Husain Jameel:</strong> Security Review, Concurrency Hardening & Automated QA</div>
            </div>

            <div class="meta-card">
                <div class="meta-card-title">Live Deployment & Infrastructure</div>
                <div class="meta-row"><strong>Merchant Portal & Checkout:</strong> <a href="https://filspay.dilmune.app">https://filspay.dilmune.app</a></div>
                <div class="meta-row"><strong>Admin Management Console:</strong> <a href="https://filspay.dilmune.app/admin">https://filspay.dilmune.app/admin</a></div>
                <div class="meta-row"><strong>Public API & Health Check:</strong> <a href="https://filspay.dilmune.app/healthz">https://filspay.dilmune.app/healthz</a></div>
                <div class="meta-row"><strong>Checkout:</strong> https://filspay.dilmune.app/pay/&lt;token&gt; (one link per invoice, created from the dashboard or the API)</div>
            </div>

            <div class="meta-card">
                <div class="meta-card-title">Repository & Code Baseline</div>
                <div class="meta-row"><strong>Public GitHub Fork:</strong> <a href="https://github.com/7assanyahya/fils-pay">https://github.com/7assanyahya/fils-pay</a></div>
                <div class="meta-row"><strong>Code verified at commit:</strong> <code>f296124317f2bc29aa26db9ea5a2be138c23fc39</code> (<code>f296124</code>)</div>
                <div class="meta-row"><strong>Branches:</strong> <code>main</code> (default), <code>7asn</code></div>
            </div>
        </div>

        <div class="cover-footer">
            <span>Official Dilmune Cloud Deployment &bull; SSL/TLS Terminated &bull; PostgreSQL 16 &bull; Fastify API &bull; Go Settlement Daemon</span>
        </div>
    </div>
    <div style="page-break-after: always;"></div>
    """

    # Replace the markdown Cover page section with our formatted cover
    html_content = re.sub(
        r'<h1>FilsPay — Competition Submission Report</h1>.*?<h1>Cover page</h1>.*?<hr />',
        cover_html,
        html_content,
        flags=re.DOTALL
    )

    # Style templates
    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>FilsPay — Competition Submission Report</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({{
            startOnLoad: true,
            theme: 'neutral',
            flowchart: {{ useMaxWidth: true, htmlLabels: true, curve: 'basis' }}
        }});
    </script>
    <style>
        @page {{
            size: A4;
            margin: 18mm 16mm 20mm 16mm;
            @bottom-right {{
                content: "Page " counter(page);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 8.5pt;
                color: #555;
            }}
            @bottom-left {{
                content: "FilsPay Competition Submission | Hit The Road";
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 8.5pt;
                color: #888;
            }}
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 9.5pt;
            line-height: 1.5;
            color: #1c1c1e;
            background: #fff;
            margin: 0;
            padding: 0;
        }}

        /* Cover Page Styling */
        .cover-container {{
            padding: 30px 10px 10px 10px;
            text-align: left;
        }}

        .cover-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #E5E5EA;
            padding-bottom: 16px;
        }}

        .cover-logo {{
            display: flex;
            align-items: center;
            gap: 12px;
        }}

        .cover-logo-text {{
            font-size: 22pt;
            font-weight: 800;
            color: #1A7F37;
            letter-spacing: -0.5px;
        }}

        .cover-badge {{
            background: #1A7F37;
            color: #ffffff;
            font-size: 8pt;
            font-weight: 700;
            padding: 5px 12px;
            border-radius: 20px;
            letter-spacing: 0.8px;
            text-transform: uppercase;
        }}

        .cover-main-title {{
            font-size: 24pt;
            font-weight: 800;
            color: #1A7F37;
            margin: 20px 0 8px 0;
            letter-spacing: -0.6px;
            line-height: 1.2;
            border-bottom: none;
            padding-bottom: 0;
        }}

        .cover-sub-title {{
            font-size: 11.5pt;
            color: #555;
            margin: 0 0 28px 0;
            font-weight: 400;
            line-height: 1.4;
        }}

        .meta-section {{
            display: flex;
            flex-direction: column;
            gap: 14px;
            margin: 24px 0;
        }}

        .meta-card {{
            background: #F9F9FB;
            border: 1px solid #E5E5EA;
            border-left: 4px solid #1A7F37;
            border-radius: 6px;
            padding: 12px 16px;
        }}

        .meta-card-title {{
            font-size: 10pt;
            font-weight: 700;
            color: #1A7F37;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 6px;
        }}

        .meta-row {{
            font-size: 9pt;
            margin-bottom: 4px;
            color: #2c2c2e;
        }}

        .meta-row:last-child {{
            margin-bottom: 0;
        }}

        .cover-footer {{
            margin-top: 40px;
            padding-top: 14px;
            border-top: 1px solid #E5E5EA;
            font-size: 8pt;
            color: #777;
            text-align: center;
        }}

        /* Headings */
        h1 {{
            font-size: 16pt;
            font-weight: 800;
            color: #1A7F37;
            margin-top: 26px;
            margin-bottom: 12px;
            border-bottom: 2px solid #E5E5EA;
            padding-bottom: 5px;
            page-break-after: avoid;
        }}

        .section-break {{
            page-break-before: always;
        }}

        h2 {{
            font-size: 12pt;
            font-weight: 700;
            color: #24292f;
            margin-top: 20px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }}

        h3 {{
            font-size: 10.5pt;
            font-weight: 700;
            color: #1A7F37;
            margin-top: 16px;
            margin-bottom: 6px;
            page-break-after: avoid;
        }}

        h4 {{
            font-size: 9.5pt;
            font-weight: 700;
            color: #24292f;
            margin-top: 12px;
            margin-bottom: 4px;
            page-break-after: avoid;
        }}

        p {{
            margin: 0 0 9px 0;
            text-align: justify;
        }}

        ul, ol {{
            margin: 0 0 10px 0;
            padding-left: 20px;
        }}

        li {{
            margin-bottom: 3px;
        }}

        /* Tables */
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0 16px 0;
            font-size: 8.5pt;
            page-break-inside: avoid;
        }}

        th {{
            background: #1A7F37;
            color: #ffffff;
            font-weight: 600;
            text-align: left;
            padding: 7px 9px;
            border: 1px solid #1A7F37;
        }}

        td {{
            padding: 6px 9px;
            border: 1px solid #E5E5EA;
            vertical-align: top;
        }}

        tr:nth-child(even) {{
            background: #F9F9FB;
        }}

        /* Code Blocks & Inline Code */
        code {{
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 8pt;
            background: #F2F2F7;
            padding: 1px 4px;
            border-radius: 3px;
            color: #1A7F37;
            border: 1px solid #E5E5EA;
        }}

        pre {{
            background: #F6F8FA;
            border: 1px solid #E1E4E8;
            border-radius: 5px;
            padding: 8px 12px;
            overflow-x: auto;
            margin: 10px 0 14px 0;
            page-break-inside: avoid;
        }}

        pre code {{
            background: transparent;
            padding: 0;
            border: none;
            color: #24292f;
            font-size: 7.5pt;
            line-height: 1.4;
        }}

        /* Mermaid Diagrams */
        .mermaid {{
            background: #FAFAFC;
            border: 1px solid #E5E5EA;
            border-radius: 6px;
            padding: 12px;
            margin: 12px 0 16px 0;
            text-align: center;
            page-break-inside: avoid;
        }}

        .mermaid svg {{
            max-width: 90% !important;
            height: auto !important;
        }}

        /* Side-by-side Image Comparisons */
        .comparison-grid {{
            display: flex;
            gap: 12px;
            margin: 12px 0 16px 0;
            page-break-inside: avoid;
        }}

        .comparison-card {{
            flex: 1;
            background: #F9F9FB;
            border: 1px solid #D1D1D6;
            border-radius: 6px;
            padding: 8px;
            text-align: center;
        }}

        .badge-before {{
            display: inline-block;
            background: #E5E5EA;
            color: #48484A;
            font-size: 7.5pt;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            margin-bottom: 6px;
            letter-spacing: 0.5px;
        }}

        .badge-after {{
            display: inline-block;
            background: #E8F5E9;
            color: #1A7F37;
            font-size: 7.5pt;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            margin-bottom: 6px;
            letter-spacing: 0.5px;
        }}

        .comp-img {{
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            border: 1px solid #E5E5EA;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }}

        .comp-filename {{
            font-size: 7pt;
            color: #8E8E93;
            margin-top: 4px;
            font-family: monospace;
        }}

        a {{
            color: #1A7F37;
            text-decoration: none;
            font-weight: 500;
        }}

        hr {{
            border: none;
            border-top: 1px solid #E5E5EA;
            margin: 18px 0;
        }}
    </style>
</head>
<body>

{html_content}

</body>
</html>
"""

    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(full_html)
    print(f"Rendered HTML generated at: {OUTPUT_HTML}")

    # Generate PDF using headless Chrome
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    cmd = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        "--enable-local-file-accesses",
        "--virtual-time-budget=7000",
        "--run-all-compositor-stages-before-draw",
        f"--print-to-pdf={OUTPUT_PDF}",
        OUTPUT_HTML
    ]
    print(f"Invoking Chrome headless to generate PDF at {OUTPUT_PDF}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(OUTPUT_PDF):
        size_kb = os.path.getsize(OUTPUT_PDF) / 1024
        print(f"SUCCESS: Generated PDF ({size_kb:.1f} KB) at: {OUTPUT_PDF}")
    else:
        print(f"FAILED to generate PDF: {res.stderr}")

if __name__ == "__main__":
    main()
