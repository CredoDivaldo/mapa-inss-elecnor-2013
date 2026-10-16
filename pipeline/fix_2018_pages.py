#!/usr/bin/env python3
"""Fix 2018 CSV files: distribute rows across pages based on image count."""
import csv
from pathlib import Path

def fix_csv_page_numbers(csv_path: Path, month_folder: Path):
    """Update page numbers in CSV based on available image files."""
    
    # Count available page images
    images = sorted(month_folder.glob("p*.png")) + sorted(month_folder.glob("p-*.png"))
    num_pages = len(images)
    
    if num_pages == 0:
        print(f"  WARNING: No images found in {month_folder}")
        return False
    
    print(f"  Found {num_pages} page images")
    
    # Read CSV rows
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"  Read {len(rows)} rows")
    
    if not rows:
        print(f"  WARNING: No data rows in {csv_path}")
        return False
    
    # Distribute rows across pages
    # Strategy: rows are already in order, just assign page numbers
    total_rows = len(rows)
    rows_per_page = total_rows / num_pages
    
    for i, row in enumerate(rows):
        # Calculate page number (0-indexed)
        page = min(int(i / rows_per_page), num_pages - 1)
        row["page"] = str(page)
    
    # Write back
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        fieldnames = ["num", "nome", "niss", "sal", "rem", "tot", "page", "y", "h"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"  Fixed {total_rows} rows across {num_pages} pages")
    return True

def main():
    import sys
    month_folder = sys.argv[1] if len(sys.argv) > 1 else "03"
    
    base = Path("/workspace/mapa-inss-elecnor-2013/data/2018")
    csv_path = base / f"{month_folder}_semifinal.csv"
    images_folder = base / month_folder
    
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}")
        return
    
    print(f"Processing {csv_path.name}")
    success = fix_csv_page_numbers(csv_path, images_folder)
    
    if success:
        print(f"✓ Fixed {csv_path}")
    else:
        print(f"✗ Failed to fix {csv_path}")

if __name__ == "__main__":
    main()
