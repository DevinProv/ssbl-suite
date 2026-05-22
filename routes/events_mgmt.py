from flask import Blueprint, jsonify, request
from database import db
from models import Event, Player, MatchSet, Game, GameParticipant, Team, RoundTemplate
from sqlalchemy.orm.attributes import flag_modified
import json
import os
import re
import urllib.request
import urllib.error

events_mgmt_bp = Blueprint("events_mgmt", __name__)

from paths import user_data_path
ROUND_MAP_PATH = user_data_path("static", "round_mapping.json")
STARTGG_CONFIG_PATH = user_data_path("static", "startgg_config.json")

DEFAULT_ROUND_MAP = {
    "Grand Final": "Grand Finals",
    "Grand Finals": "Grand Finals",
    "Final": "Grand Finals",
    "Winners Final": "Winners Finals",
    "Winners Semi-Final": "Semis",
    "Winners Quarter-Final": "Quarters",
    "Semi-Final": "Semis",
    "Quarter-Final": "Quarters",
    "Losers Final": "Losers Finals",
    "Losers Semi-Final": "Losers Semis",
    "Losers Quarter-Final": "Losers Quarters",
    "Losers Round 1": "Losers Round 1",
    "Losers Round 2": "Losers Round 2",
}

# =====================
# Config helpers
# =====================
def load_round_map():
    if os.path.exists(ROUND_MAP_PATH):
        with open(ROUND_MAP_PATH) as f:
            return json.load(f)
    return DEFAULT_ROUND_MAP.copy()

def save_round_map(data):
    with open(ROUND_MAP_PATH, "w") as f:
        json.dump(data, f, indent=2)

def load_startgg_config():
    if os.path.exists(STARTGG_CONFIG_PATH):
        with open(STARTGG_CONFIG_PATH) as f:
            return json.load(f)
    return {"api_key": ""}

def save_startgg_config(data):
    with open(STARTGG_CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)

# =====================
# Round Mapping routes
# =====================
@events_mgmt_bp.route("/events/round-map", methods=["GET"])
def get_round_map():
    return jsonify(load_round_map())

@events_mgmt_bp.route("/events/round-map", methods=["POST"])
def set_round_map():
    data = request.get_json()
    save_round_map(data)
    return jsonify({"ok": True})

# =====================
# start.gg config routes
# =====================
@events_mgmt_bp.route("/startgg/config", methods=["GET"])
def get_startgg_config():
    cfg = load_startgg_config()
    key = cfg.get("api_key", "")
    return jsonify({"api_key": key, "has_key": bool(key)})

@events_mgmt_bp.route("/startgg/config", methods=["POST"])
def save_startgg_config_route():
    data = request.get_json()
    save_startgg_config({"api_key": data.get("api_key", "")})
    return jsonify({"ok": True})

# =====================
# Shared helpers
# =====================
def translate_round(raw_name, round_map):
    return round_map.get(raw_name, raw_name)

def find_player_by_name_or_alias(name):
    name_lower = name.lower().strip()
    players = Player.query.all()
    for p in players:
        if p.name.lower().strip() == name_lower:
            return p
        aliases = p.aliases or []
        if any(a.lower().strip() == name_lower for a in aliases):
            return p
    return None

def detect_source(url):
    url = url.strip()
    if "start.gg" in url or "smash.gg" in url:
        return "startgg"
    if "challonge.com" in url:
        return "challonge"
    return None

def strip_tag(name):
    """Strip sponsor/team tag prefix: 'GA64 | Oromia64' -> 'Oromia64'"""
    if "|" in name:
        return name.split("|", 1)[1].strip()
    return name.strip()

# =====================
# Challonge — URL parsing
# =====================
def parse_challonge_url(url):
    url = url.strip().rstrip("/")
    # Subdomain bracket: org.challonge.com/slug
    m = re.match(r"https?://([^.]+)\.challonge\.com/(?:tournaments/)?([^/?]+)", url)
    if m:
        subdomain, slug = m.group(1), m.group(2)
        if subdomain != "www":
            return f"{subdomain}-{slug}", f"https://{subdomain}.challonge.com/{slug}.json"
    # Standard: challonge.com/slug
    m = re.match(r"https?://(?:www\.)?challonge\.com/(?:tournaments/)?([^/?]+)", url)
    if m:
        slug = m.group(1)
        return slug, f"https://challonge.com/{slug}.json"
    return None, None

# =====================
# Challonge — HTTP fetch
# =====================
def fetch_challonge(json_url):
    try:
        req = urllib.request.Request(
            json_url + "?include_participants=1&include_matches=1",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "en-US,en;q=0.9",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": "https://challonge.com/",
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code} — bracket may be private or invalid."}
    except Exception as e:
        return {"error": str(e)}

# =====================
# Challonge — format detection & normalisation
# =====================
def _extract_challonge_matches(bracket):
    """
    Challonge returns two different JSON shapes depending on context:

    Classic  — bracket["tournament"]["matches"] = [{"match": {...}}, ...]
               bracket["tournament"]["participants"] = [{"participant": {...}}, ...]

    SchedulePlotter — bracket["matches_by_round"] = {"1": [...], "2": [...]}
                      player data embedded in each match as player1/player2 dicts

    Returns (raw_matches, participants_dict, format_name)
    """
    # ── SchedulePlotter ───────────────────────────────────────────────
    if "matches_by_round" in bracket:
        raw_matches = []
        for round_list in bracket["matches_by_round"].values():
            raw_matches.extend(round_list)

        # Also check if there's a nested tournament key with more rounds
        tournament = bracket.get("tournament", {})
        for round_list in tournament.get("matches_by_round", {}).values():
            raw_matches.extend(round_list)

        # Build a participants lookup from embedded player objects
        participants = {}
        for m in raw_matches:
            for key in ("player1", "player2"):
                p = m.get(key)
                if isinstance(p, dict) and p.get("id"):
                    participants[p["id"]] = p

        return raw_matches, participants, "scheduleplotter"

    # ── Classic ───────────────────────────────────────────────────────
    tournament = bracket.get("tournament", {})
    raw_matches = []

    for item in tournament.get("matches", []):
        raw_matches.append(item["match"] if "match" in item else item)
    for round_list in tournament.get("matches_by_round", {}).values():
        raw_matches.extend(round_list)
    for group in bracket.get("groups", []):
        for round_list in group.get("matches_by_round", {}).values():
            raw_matches.extend(round_list)

    participants = {}
    for item in tournament.get("participants", []):
        p = item["participant"] if "participant" in item else item
        participants[p["id"]] = p

    return raw_matches, participants, "classic"


def _player_name(match, player_key, participants):
    """Extract display name for player1 or player2 from a match dict."""
    p_obj = match.get(player_key)
    if isinstance(p_obj, dict):
        name = p_obj.get("display_name") or p_obj.get("name", "")
        if name:
            return name

    # Classic fallback via separate participants dict
    pid_key = "player1_id" if player_key == "player1" else "player2_id"
    pid = match.get(pid_key)
    if pid and pid in participants:
        p = participants[pid]
        return p.get("display_name") or p.get("name", "Unknown")

    return "Unknown"


def _player_id(match, player_key):
    """Extract the numeric id for player1 or player2."""
    p_obj = match.get(player_key)
    if isinstance(p_obj, dict):
        return p_obj.get("id")
    pid_key = "player1_id" if player_key == "player1" else "player2_id"
    return match.get(pid_key)


def _extract_score(match):
    """
    Return (score1, score2) from whichever score field is present.

    SchedulePlotter: scores = [[3, 0]]  or  games = [[3, 0]]
    Classic:         scores_csv = "3-0"  or  score_in_sets = "3-0"
    """
    # SchedulePlotter nested list
    for field in ("scores", "games"):
        raw = match.get(field)
        if raw and isinstance(raw, list) and len(raw) > 0:
            first = raw[0]
            if isinstance(first, (list, tuple)) and len(first) == 2:
                return first[0], first[1]
            if isinstance(first, (int, float)) and len(raw) >= 2:
                return raw[0], raw[1]

    # Classic CSV string e.g. "3-0"
    for field in ("scores_csv", "score_in_sets"):
        raw = match.get(field)
        if raw and isinstance(raw, str) and "-" in raw:
            parts = raw.split("-")
            try:
                return int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                pass

    return None, None

# =====================
# Challonge — round name derivation
# =====================
def derive_round_name(round_num, max_winners, max_losers):
    if round_num == 0:
        return "Grand Finals"
    if round_num > 0:
        from_end = max_winners - round_num
        if from_end == 0: return "Winners Finals"
        if from_end == 1: return "Semis"
        if from_end == 2: return "Quarters"
        if from_end == 3: return "Round of 16"
        return f"Winners Round {round_num}"
    else:
        from_end = abs(max_losers) - abs(round_num)
        if from_end == 0: return "Losers Finals"
        if from_end == 1: return "Losers Semis"
        if from_end == 2: return "Losers Quarters"
        return f"Losers Round {abs(round_num)}"

# =====================
# Challonge — full preview builder
# =====================
def build_challonge_preview(url):
    slug, json_url = parse_challonge_url(url)
    if not slug:
        return {"error": "Invalid Challonge URL"}

    bracket = fetch_challonge(json_url)
    if "error" in bracket:
        return {"error": f"Failed to fetch bracket: {bracket['error']}"}

    raw_matches, participants, fmt = _extract_challonge_matches(bracket)

    # Keep only completed matches (both players present + winner known OR state=complete)
    def is_complete(m):
        has_players = bool(_player_id(m, "player1") and _player_id(m, "player2"))
        complete = m.get("state") == "complete" or m.get("winner_id") is not None
        return has_players and complete

    matches = [m for m in raw_matches if is_complete(m)]

    if not matches:
        return {"error": "No completed matches found in this bracket."}

    # Detect round-robin so we use simple "Round N" labels
    tournament = bracket.get("tournament", {})
    tournament_type = (tournament.get("tournament_type") or "").lower()
    is_round_robin = "round robin" in tournament_type

    winner_rounds = [m["round"] for m in matches if m.get("round", 0) > 0]
    loser_rounds  = [m["round"] for m in matches if m.get("round", 0) < 0]
    max_winners   = max(winner_rounds) if winner_rounds else 1
    max_losers    = min(loser_rounds)  if loser_rounds  else -1

    round_map = load_round_map()
    preview_matches = []
    unmatched_names = set()

    for m in matches:
        p1_name   = _player_name(m, "player1", participants)
        p2_name   = _player_name(m, "player2", participants)
        p1_id     = _player_id(m, "player1")
        p2_id     = _player_id(m, "player2")
        winner_id = m.get("winner_id")

        winner_name = None
        if winner_id:
            if winner_id == p1_id:
                winner_name = p1_name
            elif winner_id == p2_id:
                winner_name = p2_name
            else:
                wp = participants.get(winner_id, {})
                winner_name = wp.get("display_name") or wp.get("name")

        round_num = m.get("round", 1)
        if is_round_robin:
            raw_round = f"Round {round_num}"
        else:
            raw_round = derive_round_name(round_num, max_winners, max_losers)
            if m.get("is_group_match"):
                raw_round = f"Pools {raw_round}"

        translated_round = translate_round(raw_round, round_map)
        score1, score2   = _extract_score(m)

        p1_db = find_player_by_name_or_alias(p1_name)
        p2_db = find_player_by_name_or_alias(p2_name)
        if not p1_db: unmatched_names.add(p1_name)
        if not p2_db: unmatched_names.add(p2_name)

        preview_matches.append({
            "round":       translated_round,
            "mode":        "singles",
            "p1_name":     p1_name,
            "p2_name":     p2_name,
            "winner_name": winner_name,
            "score1":      score1,
            "score2":      score2,
            "p1_found":    p1_db is not None,
            "p2_found":    p2_db is not None,
            "p1_db_id":    p1_db.id if p1_db else None,
            "p2_db_id":    p2_db.id if p2_db else None,
        })

    # Deduplicate — SchedulePlotter sometimes includes the same match twice
    seen, deduped = set(), []
    for m in preview_matches:
        key = (m["p1_name"], m["p2_name"], m["round"])
        if key not in seen:
            seen.add(key)
            deduped.append(m)
    preview_matches = deduped

    tournament_title = tournament.get("name", slug)
    unique_rounds    = list(dict.fromkeys(m["round"] for m in preview_matches))
    existing_event   = Event.query.filter_by(bracketSlug=slug).first()

    return {
        "source": "challonge",
        "slug":   slug,
        "url":    url,
        "sub_events": [{
            "title":          tournament_title,
            "slug":           slug,
            "matches":        preview_matches,
            "unique_rounds":  unique_rounds,
            "existing_event": (
                {"id": existing_event.id, "title": existing_event.eventTitle}
                if existing_event else None
            ),
        }],
        "unmatched_names": list(unmatched_names),
        "total_matches":   len(preview_matches),
    }

# =====================
# start.gg — helpers
# =====================
def parse_startgg_url(url):
    url = url.strip().rstrip("/")
    m = re.match(r"https?://(?:www\.)?(?:start|smash)\.gg/tournament/([^/?#]+)", url)
    return m.group(1) if m else None

def startgg_query(query, variables, api_key):
    endpoint = "https://api.start.gg/gql/alpha"
    payload  = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "SSBL-App/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return {"errors": [{"message": f"HTTP {e.code}: {body[:200]}"}]}
    except Exception as e:
        return {"errors": [{"message": str(e)}]}

TOURNAMENT_EVENTS_QUERY = """
query TournamentEvents($slug: String!) {
  tournament(slug: $slug) {
    id
    name
    events {
      id
      name
      slug
      numEntrants
      teamRosterSize { minPlayers maxPlayers }
    }
  }
}
"""

EVENT_SETS_QUERY = """
query EventSets($eventId: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eventId) {
    sets(page: $page, perPage: $perPage, filters: { state: 3 }) {
      pageInfo { total totalPages }
      nodes {
        id
        fullRoundText
        winnerId
        slots {
          standing { stats { score { value } } }
          entrant {
            id
            name
            participants { gamerTag }
          }
        }
      }
    }
  }
}
"""

def parse_entrant(entrant):
    if not entrant:
        return None
    participants = entrant.get("participants", [])
    entrant_id   = entrant["id"]
    entrant_name = entrant.get("name", "")

    if len(participants) == 1:
        tag = strip_tag(participants[0].get("gamerTag", entrant_name))
        return {"type": "singles", "player_name": tag, "entrant_id": entrant_id}
    elif len(participants) == 2:
        p1 = strip_tag(participants[0].get("gamerTag", ""))
        p2 = strip_tag(participants[1].get("gamerTag", ""))
        return {"type": "doubles", "team_name": entrant_name,
                "player1": p1, "player2": p2, "entrant_id": entrant_id}
    else:
        return {"type": "singles", "player_name": strip_tag(entrant_name),
                "entrant_id": entrant_id}

def fetch_startgg_sets(event_id, api_key):
    all_sets = []
    page = 1

    while True:
        result = startgg_query(EVENT_SETS_QUERY,
                               {"eventId": event_id, "page": page, "perPage": 50},
                               api_key)
        if "errors" in result:
            return None, result["errors"][0]["message"]

        sets_data   = result.get("data", {}).get("event", {}).get("sets", {})
        nodes       = sets_data.get("nodes", [])
        total_pages = sets_data.get("pageInfo", {}).get("totalPages", 1)

        for s in nodes:
            slots = s.get("slots", [])
            if len(slots) < 2:
                continue
            e1 = parse_entrant(slots[0].get("entrant"))
            e2 = parse_entrant(slots[1].get("entrant"))
            if not e1 or not e2:
                continue

            def _score(slot):
                v = slot.get("standing", {}).get("stats", {}).get("score", {}).get("value")
                return 0 if (v is not None and v < 0) else v

            all_sets.append({
                "id":               s["id"],
                "round":            s.get("fullRoundText") or "Unknown Round",
                "winner_entrant_id": s.get("winnerId"),
                "entrant1":         e1,
                "entrant2":         e2,
                "score1":           _score(slots[0]),
                "score2":           _score(slots[1]),
            })

        if page >= total_pages:
            break
        page += 1

    return all_sets, None

# =====================
# start.gg — full preview builder
# =====================
def build_startgg_preview(url, api_key):
    if not api_key:
        return {"error": "No start.gg API key configured. Add it in Settings."}

    slug = parse_startgg_url(url)
    if not slug:
        return {"error": "Invalid start.gg URL. Expected: start.gg/tournament/your-tournament"}

    result = startgg_query(TOURNAMENT_EVENTS_QUERY, {"slug": slug}, api_key)
    if "errors" in result:
        return {"error": f"start.gg API error: {result['errors'][0]['message']}"}

    tournament_data = result.get("data", {}).get("tournament")
    if not tournament_data:
        return {"error": "Tournament not found. Check the URL and make sure it's public."}

    tournament_name = tournament_data["name"]
    events          = tournament_data.get("events", [])
    if not events:
        return {"error": "No events found in this tournament."}

    round_map    = load_round_map()
    sub_events   = []
    all_unmatched = set()
    total_matches = 0

    for event in events:
        event_id   = event["id"]
        event_slug = event.get("slug", "")
        compound_title = f"{tournament_name} - {event['name']}"

        sets, error = fetch_startgg_sets(event_id, api_key)
        if error or not sets:
            continue

        event_mode = sets[0]["entrant1"]["type"] if sets else "singles"
        preview_matches = []
        unmatched_names = set()

        for s in sets:
            e1           = s["entrant1"]
            e2           = s["entrant2"]
            winner_eid   = s["winner_entrant_id"]
            trans_round  = translate_round(s["round"], round_map)

            if event_mode == "singles":
                p1_name = e1["player_name"]
                p2_name = e2["player_name"]
                winner_name = None
                if winner_eid:
                    if winner_eid == e1["entrant_id"]:   winner_name = p1_name
                    elif winner_eid == e2["entrant_id"]: winner_name = p2_name

                p1_db = find_player_by_name_or_alias(p1_name)
                p2_db = find_player_by_name_or_alias(p2_name)
                if not p1_db: unmatched_names.add(p1_name)
                if not p2_db: unmatched_names.add(p2_name)

                preview_matches.append({
                    "round":       trans_round,
                    "mode":        "singles",
                    "p1_name":     p1_name,
                    "p2_name":     p2_name,
                    "winner_name": winner_name,
                    "score1":      s.get("score1"),
                    "score2":      s.get("score2"),
                    "p1_found":    p1_db is not None,
                    "p2_found":    p2_db is not None,
                    "p1_db_id":    p1_db.id if p1_db else None,
                    "p2_db_id":    p2_db.id if p2_db else None,
                })

            else:  # doubles
                t1p1_name = e1["player1"]; t1p2_name = e1["player2"]
                t2p1_name = e2["player1"]; t2p2_name = e2["player2"]
                winner_team_name = None
                if winner_eid:
                    if winner_eid == e1["entrant_id"]:   winner_team_name = e1["team_name"]
                    elif winner_eid == e2["entrant_id"]: winner_team_name = e2["team_name"]

                t1p1_db = find_player_by_name_or_alias(t1p1_name)
                t1p2_db = find_player_by_name_or_alias(t1p2_name)
                t2p1_db = find_player_by_name_or_alias(t2p1_name)
                t2p2_db = find_player_by_name_or_alias(t2p2_name)
                for name, found in [(t1p1_name, t1p1_db), (t1p2_name, t1p2_db),
                                     (t2p1_name, t2p1_db), (t2p2_name, t2p2_db)]:
                    if not found: unmatched_names.add(name)

                preview_matches.append({
                    "round":       trans_round,
                    "mode":        "doubles",
                    "p1_name":     e1["team_name"],
                    "p2_name":     e2["team_name"],
                    "t1p1_name":   t1p1_name, "t1p2_name": t1p2_name,
                    "t2p1_name":   t2p1_name, "t2p2_name": t2p2_name,
                    "winner_name": winner_team_name,
                    "score1":      s.get("score1"),
                    "score2":      s.get("score2"),
                    "t1p1_found":  t1p1_db is not None, "t1p2_found": t1p2_db is not None,
                    "t2p1_found":  t2p1_db is not None, "t2p2_found": t2p2_db is not None,
                    "p1_found":    t1p1_db is not None and t1p2_db is not None,
                    "p2_found":    t2p1_db is not None and t2p2_db is not None,
                })

        all_unmatched.update(unmatched_names)
        unique_rounds  = list(dict.fromkeys(m["round"] for m in preview_matches))
        existing_event = Event.query.filter_by(bracketSlug=event_slug).first()
        total_matches += len(preview_matches)

        sub_events.append({
            "title":          compound_title,
            "slug":           event_slug,
            "event_id":       event_id,
            "mode":           event_mode,
            "matches":        preview_matches,
            "unique_rounds":  unique_rounds,
            "existing_event": (
                {"id": existing_event.id, "title": existing_event.eventTitle}
                if existing_event else None
            ),
        })

    if not sub_events:
        return {"error": "No completed sets found in any event of this tournament."}

    return {
        "source":          "startgg",
        "slug":            slug,
        "url":             url,
        "tournament_name": tournament_name,
        "sub_events":      sub_events,
        "unmatched_names": list(all_unmatched),
        "total_matches":   total_matches,
    }

# =====================
# Dummy game row creation
# =====================
def create_dummy_games(match_set, winner_players, loser_players, winner_score, loser_score,
                       winner_team_id=None, loser_team_id=None):
    """
    Build Game + GameParticipant rows from a reported score (e.g. 3-1).
    No character data — imported sets don't carry that.
    """
    game_num = 1
    for _ in range(winner_score):
        game = Game(setID=match_set.id, gameNumber=game_num)
        db.session.add(game)
        db.session.flush()
        for p in winner_players:
            db.session.add(GameParticipant(
                gameID=game.id, playerID=p.id,
                teamID=winner_team_id, character=None, isWinner=True))
        for p in loser_players:
            db.session.add(GameParticipant(
                gameID=game.id, playerID=p.id,
                teamID=loser_team_id, character=None, isWinner=False))
        game_num += 1

    for _ in range(loser_score):
        game = Game(setID=match_set.id, gameNumber=game_num)
        db.session.add(game)
        db.session.flush()
        for p in loser_players:
            db.session.add(GameParticipant(
                gameID=game.id, playerID=p.id,
                teamID=loser_team_id, character=None, isWinner=True))
        for p in winner_players:
            db.session.add(GameParticipant(
                gameID=game.id, playerID=p.id,
                teamID=winner_team_id, character=None, isWinner=False))
        game_num += 1

# =====================
# Preview route (unified)
# =====================
@events_mgmt_bp.route("/events/import/preview", methods=["POST"])
def import_preview():
    data = request.get_json()
    url  = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL required"}), 400

    source = detect_source(url)
    if not source:
        return jsonify({"error": "Unrecognized URL. Paste a Challonge or start.gg link."}), 400

    if source == "challonge":
        result = build_challonge_preview(url)
    else:
        cfg    = load_startgg_config()
        result = build_startgg_preview(url, cfg.get("api_key", ""))

    if "error" in result:
        return jsonify(result), 400

    return jsonify(result)

# =====================
# Import / execute route (unified)
# =====================
@events_mgmt_bp.route("/events/import/execute", methods=["POST"])
def import_execute():
    data        = request.get_json()
    sub_events  = data.get("sub_events", [])
    resolutions = data.get("resolutions", {})
    reimport    = data.get("reimport", False)

    if not sub_events:
        return jsonify({"error": "No sub_events to import"}), 400

    # ── Resolve unmatched player names first ─────────────────────────
    player_cache = {}

    for name, res in resolutions.items():
        if res["action"] == "create":
            player = Player(
                name=res.get("name", name),
                defaultChar=None, defaultCharColor=None,
                aliases=[name],
            )
            db.session.add(player)
            db.session.flush()
            player_cache[name] = player

        elif res["action"] == "merge":
            player = Player.query.get(res["player_id"])
            if player:
                aliases = player.aliases or []
                if name not in aliases:
                    aliases.append(name)
                    player.aliases = aliases
                    flag_modified(player, "aliases")
                player_cache[name] = player

    db.session.flush()

    results = []

    for sub in sub_events:
        slug          = sub.get("slug", "")
        title         = sub.get("title", slug)
        matches       = sub.get("matches", [])
        unique_rounds = sub.get("unique_rounds", [])

        existing = Event.query.filter_by(bracketSlug=slug).first() if slug else None

        if existing and not reimport:
            results.append({
                "title": title, "event_id": existing.id,
                "skipped": True, "reason": "already_imported",
            })
            continue

        if existing and reimport:
            # Wipe existing sets so we get a clean re-import
            for s in MatchSet.query.filter_by(eventID=existing.id).all():
                db.session.delete(s)
            db.session.flush()
            event = existing
            event.eventTitle = title
            event.rounds     = unique_rounds
            flag_modified(event, "rounds")
        else:
            event = Event(
                eventTitle=title, eventDate="",
                bracketSlug=slug, rounds=unique_rounds,
            )
            db.session.add(event)
            db.session.flush()

        # Pre-cache players that are already in the DB
        all_names = set()
        for m in matches:
            if m.get("mode") == "doubles":
                all_names.update([m["t1p1_name"], m["t1p2_name"],
                                   m["t2p1_name"], m["t2p2_name"]])
            else:
                all_names.update([m["p1_name"], m["p2_name"]])

        for name in all_names:
            if name and name not in player_cache:
                p = find_player_by_name_or_alias(name)
                if p:
                    player_cache[name] = p

        imported = skipped = 0

        for m in matches:
            mode = m.get("mode", "singles")

            # ── Singles ──────────────────────────────────────────────
            if mode == "singles":
                p1     = player_cache.get(m["p1_name"])
                p2     = player_cache.get(m["p2_name"])
                winner = player_cache.get(m["winner_name"]) if m.get("winner_name") else None

                if not p1 or not p2:
                    skipped += 1
                    continue

                match_set = MatchSet(
                    eventID=event.id, bracketRound=m["round"], mode="singles",
                    player1ID=p1.id, player2ID=p2.id,
                    winnerID=winner.id if winner else None,
                )
                db.session.add(match_set)
                db.session.flush()

                score1 = m.get("score1")
                score2 = m.get("score2")
                if winner and score1 is not None and score2 is not None:
                    loser        = p2 if winner.id == p1.id else p1
                    winner_score = score1 if winner.id == p1.id else score2
                    loser_score  = score2 if winner.id == p1.id else score1
                    create_dummy_games(match_set, [winner], [loser],
                                       winner_score, loser_score)
                imported += 1

            # ── Doubles ──────────────────────────────────────────────
            elif mode == "doubles":
                t1p1 = player_cache.get(m["t1p1_name"])
                t1p2 = player_cache.get(m["t1p2_name"])
                t2p1 = player_cache.get(m["t2p1_name"])
                t2p2 = player_cache.get(m["t2p2_name"])

                if not all([t1p1, t1p2, t2p1, t2p2]):
                    skipped += 1
                    continue

                team1 = Team(name=m["p1_name"], eventID=event.id,
                             player1ID=t1p1.id, player2ID=t1p2.id)
                team2 = Team(name=m["p2_name"], eventID=event.id,
                             player1ID=t2p1.id, player2ID=t2p2.id)
                db.session.add_all([team1, team2])
                db.session.flush()

                winner_team_id = None
                if m.get("winner_name"):
                    if m["winner_name"] == m["p1_name"]:   winner_team_id = team1.id
                    elif m["winner_name"] == m["p2_name"]: winner_team_id = team2.id

                match_set = MatchSet(
                    eventID=event.id, bracketRound=m["round"], mode="doubles",
                    team1ID=team1.id, team2ID=team2.id,
                    winnerTeamID=winner_team_id,
                )
                db.session.add(match_set)
                db.session.flush()

                score1 = m.get("score1")
                score2 = m.get("score2")
                if winner_team_id and score1 is not None and score2 is not None:
                    is_t1_winner   = winner_team_id == team1.id
                    winner_team    = team1 if is_t1_winner else team2
                    loser_team     = team2 if is_t1_winner else team1
                    w_score        = score1 if is_t1_winner else score2
                    l_score        = score2 if is_t1_winner else score1
                    wp1_key        = "t1p1_name" if is_t1_winner else "t2p1_name"
                    wp2_key        = "t1p2_name" if is_t1_winner else "t2p2_name"
                    lp1_key        = "t2p1_name" if is_t1_winner else "t1p1_name"
                    lp2_key        = "t2p2_name" if is_t1_winner else "t1p2_name"
                    winner_players = [p for p in [player_cache.get(m[wp1_key]),
                                                   player_cache.get(m[wp2_key])] if p]
                    loser_players  = [p for p in [player_cache.get(m[lp1_key]),
                                                   player_cache.get(m[lp2_key])] if p]
                    if winner_players and loser_players:
                        create_dummy_games(
                            match_set, winner_players, loser_players, w_score, l_score,
                            winner_team_id=winner_team.id, loser_team_id=loser_team.id,
                        )
                imported += 1

        results.append({
            "title":         title,
            "event_id":      event.id,
            "imported":      imported,
            "skipped":       skipped,
            "skipped_event": False,
        })

    db.session.commit()

    return jsonify({
        "ok":            True,
        "results":       results,
        "total_imported": sum(r.get("imported", 0) for r in results),
        "events_created": len([r for r in results if not r.get("skipped_event")]),
    })

# =====================
# Legacy Challonge routes (backwards compat)
# =====================
@events_mgmt_bp.route("/events/challonge/preview", methods=["POST"])
def challonge_preview_legacy():
    return import_preview()

@events_mgmt_bp.route("/events/challonge/import", methods=["POST"])
def challonge_import_legacy():
    data    = request.get_json()
    matches = data.get("matches", [])
    request.json["sub_events"] = [{
        "slug":          data.get("slug"),
        "title":         data.get("title"),
        "matches":       matches,
        "unique_rounds": list(dict.fromkeys(m["round"] for m in matches)),
    }]
    request.json["resolutions"] = data.get("resolutions", {})
    request.json["reimport"]    = data.get("reimport", False)
    return import_execute()