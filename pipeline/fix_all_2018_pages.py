#!/usr/bin/env python3
"""Fix all 2018 CSV files: distribute rows across pages based on image count."""
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
    
    # Distribute rows across pages based on the row's original 'num' field
    # Find max num to understand distribution
    max_num = max(int(r.get("num", 0) or 0) for r in rows)
    if max_num == 0:
        # Fallback: distribute evenly
        rows_per_page = len(rows) / num_pages
        for i, row in enumerate(rows):
            page = min(int(i / rows_per_page), num_pages - 1)
            row["page"] = str(page)
    else:
        # Map num to page based on known page boundaries
        # Use the existing y coordinate or distribute proportionally
        rows_per_page = max_num / num_pages
        for row in rows:
            num_val = int(row.get("num", 0) or 0)
            if num_val > 0:
                page = min(int((num_val - 1) / rows_per_page), num_pages - 1)
                row["page"] = str(page)
            else:
                row["page"] = "0"
    
    # Write back
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        fieldnames = ["num", "nome", "niss", "sal", "rem", "tot", "page", "y", "h"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"  Fixed {len(rows)} rows across {num_pages} pages")
    return True

def main():
    base = Path("/workspace/mapa-inss-elecnor-2013/data/2018")
    
    # Find all CSV files that need fixing
    csv_files = list(base.glob("*semifinal.csv"))
    
    print(f"Found {len(csv_files)} CSV files to fix\n")
    
    fixed = 0
    for csv_path in csv_files:
        # Extract month number from filename (e.g., 03_semifinal.csv -> 03)
        month_str = csv_path.name.split("_")[0]
        month_folder = base / month_str
        print(f"Processing {csv_path.name} -> {month_folder}")
        
        success = fix_csv_page_numbers(csv_path, month_folder)
        if success:
            fixed += 1
            print(f"✓ Fixed {csv_path}\n")
        else:
            print(f"✗ Failed to fix {csv_path}\n")
    
    print(f"\n{'='*50}")
    print(f"Total: {fixed}/{len(csv_files)} files fixed")

if __name__ == "__main__":
    main()
