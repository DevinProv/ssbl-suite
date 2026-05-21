from flask import Blueprint, jsonify, request
from database import db
from models import Event, RoundTemplate
from sqlalchemy.orm.attributes import flag_modified

events_bp = Blueprint("events", __name__)

# =====================
# Built-in templates seeded on first use
# =====================
BUILTIN_TEMPLATES = [
    {
        "name": "Standard Bracket",
        "rounds": [
            "Pools", "Round of 16", "Quarters", "Semis",
            "Losers Round 1", "Losers Round 2", "Losers Quarters", "Losers Semis",
            "Losers Finals", "Winners Finals", "Grand Finals"
        ]
    },
    {
        "name": "Top 8",
        "rounds": [
            "Quarters", "Semis", "Losers Quarters", "Losers Semis",
            "Losers Finals", "Winners Finals", "Grand Finals"
        ]
    },
    {
        "name": "Top 4",
        "rounds": [
            "Semis", "Losers Semis", "Losers Finals", "Winners Finals", "Grand Finals"
        ]
    },
    {
        "name": "Round Robin",
        "rounds": ["Round 1", "Round 2", "Round 3", "Finals"]
    },
]

def seed_builtins():
    """Seed built-in templates if not already present."""
    for t in BUILTIN_TEMPLATES:
        exists = RoundTemplate.query.filter_by(name=t["name"], is_builtin=True).first()
        if not exists:
            db.session.add(RoundTemplate(
                name=t["name"],
                rounds=t["rounds"],
                is_builtin=True
            ))
    db.session.commit()

def serialize_event(e):
    return {
        "id": e.id,
        "eventTitle": e.eventTitle,
        "eventDate": e.eventDate,
        "bracketLink": e.bracketLink,
        "rounds": e.rounds or [],
        "bracketSlug": e.bracketSlug
    }

def serialize_template(t):
    return {
        "id": t.id,
        "name": t.name,
        "rounds": t.rounds or [],
        "is_builtin": t.is_builtin
    }

# =====================
# Events
# =====================
@events_bp.route("/events", methods=["GET"])
def get_events():
    events = Event.query.all()
    return jsonify([serialize_event(e) for e in events])

@events_bp.route("/events/<int:event_id>", methods=["GET"])
def get_event(event_id):
    event = Event.query.get(event_id)
    if event is None:
        return jsonify({"error": "Event not found"}), 404
    return jsonify(serialize_event(event))

@events_bp.route("/events", methods=["POST"])
def create_event():
    data = request.get_json()
    if not data or "eventTitle" not in data:
        return jsonify({"error": "Invalid request"}), 400
    event = Event(
        eventTitle=data["eventTitle"],
        eventDate=data.get("eventDate", ""),
        bracketLink=data.get("bracketLink"),
        rounds=data.get("rounds", [])
    )
    db.session.add(event)
    db.session.commit()
    return jsonify(serialize_event(event)), 201

@events_bp.route("/events/<int:event_id>", methods=["PUT"])
def update_event(event_id):
    event = Event.query.get(event_id)
    if event is None:
        return jsonify({"error": "Event not found"}), 404
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    if "eventTitle" in data:
        event.eventTitle = data["eventTitle"]
    if "eventDate" in data:
        event.eventDate = data["eventDate"]
    if "bracketLink" in data:
        event.bracketLink = data["bracketLink"]
    if "rounds" in data:
        event.rounds = data["rounds"]
        flag_modified(event, "rounds")
    db.session.commit()
    return jsonify(serialize_event(event)), 200

@events_bp.route("/events/<int:event_id>", methods=["DELETE"])
def delete_event(event_id):
    event = Event.query.get(event_id)
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    # Delete all sets under this event, cascading through games and participants.
    # Also clean up Teams and ClipExports which have no SQLAlchemy cascade from Event.
    from models import MatchSet, Game, GameParticipant, Team, ClipExport

    sets = MatchSet.query.filter_by(eventID=event_id).all()
    for s in sets:
        # ClipExport has a unique=True FK to MatchSet but no cascade
        clip = ClipExport.query.filter_by(setID=s.id).first()
        if clip:
            db.session.delete(clip)

        # Games cascade to GameParticipant via the relationship on Game,
        # but we need to hit them explicitly since Event→MatchSet has no cascade
        for game in s.games:
            db.session.delete(game)  # GameParticipant cascades via Game.participants

        db.session.delete(s)

    # Teams are per-event — delete them too
    Team.query.filter_by(eventID=event_id).delete()

    db.session.delete(event)
    db.session.commit()
    return jsonify({"ok": True})

# =====================
# Round Templates
# =====================
@events_bp.route("/templates", methods=["GET"])
def get_templates():
    seed_builtins()
    templates = RoundTemplate.query.all()
    return jsonify([serialize_template(t) for t in templates])

@events_bp.route("/templates", methods=["POST"])
def create_template():
    data = request.get_json()
    if not data or "name" not in data or "rounds" not in data:
        return jsonify({"error": "Invalid request"}), 400
    template = RoundTemplate(
        name=data["name"],
        rounds=data["rounds"],
        is_builtin=False
    )
    db.session.add(template)
    db.session.commit()
    return jsonify(serialize_template(template)), 201

@events_bp.route("/templates/<int:template_id>", methods=["DELETE"])
def delete_template(template_id):
    template = RoundTemplate.query.get(template_id)
    if template is None:
        return jsonify({"error": "Not found"}), 404
    if template.is_builtin:
        return jsonify({"error": "Cannot delete built-in templates"}), 400
    db.session.delete(template)
    db.session.commit()
    return jsonify({"ok": True})