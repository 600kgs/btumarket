"""
Quickly seed the marketplace with 12 test listings.
 
Usage:
    py seed_listings.py
 
Requires the backend to already be running (py -m uvicorn main:app --reload --port 8001)
and the `requests` package (py -m pip install requests).
"""
 
import requests
 
API = "http://127.0.0.1:8001"
 
# A throwaway seller account just for test data.
SEED_USER = {
    "username": "seeduser",
    "email": "seeduser@example.com",
    "phone": "555-0000",
    "password": "seedpassword123",
}
 
CATEGORIES = ["textbooks", "notes", "electronics", "clothes", "dorm", "bikes", "sports", "tickets", "services", "other"]
 
LISTINGS = [
    {"title": f"Test Item {i+1}", "description": f"Auto-generated test listing #{i+1}.",
     "price": 10.0 + i * 5, "category": CATEGORIES[i % len(CATEGORIES)]}
    for i in range(12)
]
 
 
def get_token() -> str:
    # Try to register; if the user already exists, that's fine, we just log in.
    requests.post(f"{API}/register", json=SEED_USER)

    # New accounts require email verification; the seed user has no inbox, so
    # flip the flag directly in the local database.
    import sqlite3
    conn = sqlite3.connect("marketplace.db")
    conn.execute("UPDATE users SET email_verified = 1 WHERE username = ?", (SEED_USER["username"],))
    conn.commit()
    conn.close()
 
    res = requests.post(f"{API}/login", json={
        "username": SEED_USER["username"],
        "password": SEED_USER["password"],
    })
    res.raise_for_status()
    return res.json()["access_token"]
 
 
def main():
    token = get_token()
    created = 0
 
    headers = {"Authorization": f"Bearer {token}"}

    for listing in LISTINGS:
        res = requests.post(f"{API}/listings", headers=headers, json=listing)
        if res.ok:
            created += 1
            print(f"Created: {listing['title']} (id={res.json()['listing_id']})")
        else:
            print(f"Failed: {listing['title']} -> {res.status_code} {res.text}")
 
    print(f"\nDone. {created}/{len(LISTINGS)} listings created.")
 
 
if __name__ == "__main__":
    main()