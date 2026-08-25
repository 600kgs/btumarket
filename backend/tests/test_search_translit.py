"""Cross-script search: Latin queries must find Georgian-script listings and
vice versa. The interesting pairs are the ones that pull the fold rules in
opposite directions - "macbook" needs c read as /k/, "macivari" needs c read
as ც - see translit.py for why both work at once."""
from translit import fold, query_folds

from test_listings import auth_headers, make_listing_payload, publish, register_and_login


def test_fold_collapses_both_scripts_to_one_skeleton():
    assert fold("მაკბუქი") == "makbuki"
    assert fold("MacBook") == "makbuk"
    assert fold("ველოსიპედი") == fold("velosipedi")
    # Aspirated/ejective pairs collapse - spelling either way matches.
    assert fold("თბილისი") == fold("ტბილისი")


def test_query_folds_covers_ambiguous_latin_letters():
    variants = query_folds("macivari")
    assert "macivari" in variants  # the ც reading
    assert "makivari" in variants  # the /k/ reading
    assert query_folds("") == []
    assert query_folds("   ") == []


def _create(client, token, title, description="აღწერა არ არის"):
    return publish(client, token, title=title, description=description)


def _search_ids(client, q):
    res = client.get("/search", params={"q": q})
    assert res.status_code == 200
    return {r["id"] for r in res.json()["results"]}


def test_latin_query_finds_georgian_listing(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    listing_id = _create(client, token, "მაკბუქი Pro 2019")
    assert listing_id in _search_ids(client, "macbook")


def test_georgian_query_finds_latin_listing(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    listing_id = _create(client, token, "MacBook Air M1")
    assert listing_id in _search_ids(client, "მაკბუქი")


def test_ambiguous_c_matches_both_readings(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    fridge = _create(client, token, "მაცივარი პატარა")
    assert fridge in _search_ids(client, "macivari")


def test_edit_refreshes_the_fold(client, unique_suffix):
    _, token = register_and_login(client, unique_suffix)
    listing_id = _create(client, token, "ძველი სათაური")
    res = client.put(
        f"/listings/{listing_id}",
        json=make_listing_payload(title="ჰუდი BTU ლოგოთი", description="თბილი"),
        headers=auth_headers(token),
    )
    assert res.status_code == 200
    assert listing_id in _search_ids(client, "hudi")
