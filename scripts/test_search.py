import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.db import Database
from app.services.kb import KBService
from app.settings import get_settings

def main():
    settings = get_settings()
    db = Database(settings.db_path)
    kb = KBService(db, settings)
    
    query = "Về mặt kỹ thuật của luồng nạp tiền stock đang như thế nào"
    print(f"Query: {query}")
    
    # 1. Search with product='Stock'
    print("\n--- Search with product='Stock' ---")
    hits = kb.search(query, product="Stock", top_k=5)
    for i, hit in enumerate(hits, 1):
        print(f"{i}. [{hit.product}] {hit.path} (score: {hit.score})")
        print(f"   Lines: {hit.lines}")
        print(f"   Snippet: {hit.snippet[:120]}...")
        
    # 2. Search without product filter
    print("\n--- Search without product filter ---")
    hits = kb.search(query, top_k=5)
    for i, hit in enumerate(hits, 1):
        print(f"{i}. [{hit.product}] {hit.path} (score: {hit.score})")
        print(f"   Snippet: {hit.snippet[:120]}...")

if __name__ == "__main__":
    main()
