from flask import Blueprint, jsonify, request
from database import db
from models import Event

events_bp = Blueprint("events", __name__)

def serialize_event(e):
    return {
        "id": e.id,
        "eventTitle": e.eventTitle,
        "eventDate": e.eventDate,
        "bracketLink": e.bracketLink
    }

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
        eventDate=data["eventDate"],
        bracketLink=data.get("bracketLink")
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
    
    db.session.commit()
    return jsonify(serialize_event(event)), 200
