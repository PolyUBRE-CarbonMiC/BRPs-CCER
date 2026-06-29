import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "experiments" / "dapp_prototype" / "standalone_prototype.html"
OUT_DIR = ROOT / "experiments" / "dapp_prototype" / "figures"

PAGES = [
    ("registry", "dapp_project_information"),
    ("cer", "dapp_cer_accounting"),
    ("revenue", "dapp_revenue_allocation"),
]

CHROME_PATHS = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
]


def browser_executable():
    for candidate in CHROME_PATHS:
        if candidate.exists():
            return str(candidate)
    return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    file_url = HTML.resolve().as_uri()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_executable())
        page = browser.new_page(viewport={"width": 1900, "height": 1200}, device_scale_factor=1)
        page.goto(file_url, wait_until="networkidle")
        page.emulate_media(media="screen")

        for page_key, stem in PAGES:
            page.click(f'button[data-page="{page_key}"]')
            page.wait_for_timeout(300)

            dims = page.evaluate(
                """() => {
                    const app = document.querySelector('.app').getBoundingClientRect();
                    const bottoms = Array.from(document.body.querySelectorAll('*'))
                        .filter((el) => {
                            const style = window.getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.display !== 'none'
                                && style.visibility !== 'hidden'
                                && rect.width > 0
                                && rect.height > 0;
                        })
                        .map((el) => el.getBoundingClientRect().bottom);
                    return {
                        width: Math.ceil(app.width),
                        height: Math.ceil(Math.max(app.bottom, ...bottoms))
                    };
                }"""
            )

            pdf_path = OUT_DIR / f"{stem}.pdf"
            svg_path = OUT_DIR / f"{stem}.svg"
            png_path = OUT_DIR / f"{stem}.png"

            with tempfile.TemporaryDirectory(prefix="dapp_svg_") as tmp:
                tmp_dir = Path(tmp)
                tmp_pdf = tmp_dir / f"{stem}.pdf"
                tmp_svg = tmp_dir / f"{stem}.svg"

                page.pdf(
                    path=str(tmp_pdf),
                    width=f"{dims['width']}px",
                    height=f"{dims['height']}px",
                    margin={"top": "0px", "right": "0px", "bottom": "0px", "left": "0px"},
                    print_background=True,
                    prefer_css_page_size=False,
                )
                page.screenshot(
                    path=str(png_path),
                    clip={"x": 0, "y": 0, "width": dims["width"], "height": dims["height"]},
                )

                subprocess.run(
                    ["pdftocairo", "-svg", str(tmp_pdf), str(tmp_svg)],
                    check=True,
                )
                pdf_path.write_bytes(tmp_pdf.read_bytes())
                svg_path.write_bytes(tmp_svg.read_bytes())
            print(f"{stem}: {dims['width']} x {dims['height']} -> {svg_path}")

        browser.close()


if __name__ == "__main__":
    main()
