#!/usr/bin/env python3
"""Check whether the local Python environment can run the analysis."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path


REQUIRED_PACKAGES = ["pandas", "numpy", "matplotlib", "openpyxl"]


def main() -> None:
    print(f"Python executable: {sys.executable}")
    print(f"Python version:    {sys.version.split()[0]}")
    print(f"Working directory: {Path.cwd()}")

    missing = []
    for package in REQUIRED_PACKAGES:
        try:
            module = importlib.import_module(package)
            version = getattr(module, "__version__", "installed")
            print(f"{package}: {version}")
        except ImportError:
            missing.append(package)
            print(f"{package}: MISSING")

    if missing:
        print("\nMissing packages. Install them with one of these commands:")
        print(f"  {sys.executable} -m pip install {' '.join(missing)}")
        print("or, in Anaconda Prompt:")
        print(f"  conda install {' '.join(missing)}")
        raise SystemExit(1)

    print("\nPython environment is ready.")


if __name__ == "__main__":
    main()
