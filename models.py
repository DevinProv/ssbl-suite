from sqlalchemy import Integer, String, ForeignKey, Float
from sqlalchemy.orm import Mapped, mapped_column
from database import db


class Player(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    defaultChar: Mapped[str | None] = mapped_column(String, nullable=True)
    defaultCharColor: Mapped[str | None] = mapped_column(String, nullable=True)

class Event(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    eventTitle: Mapped[str] = mapped_column(String, nullable=False)
    eventDate: Mapped[str] = mapped_column(String, nullable=False)
    bracketLink: Mapped[str | None] = mapped_column(String, nullable=True)

class MatchSet(db.Model):
    __tablename__ = "match_set"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    eventID: Mapped[int] = mapped_column(Integer, ForeignKey("event.id"), nullable=False)
    bracketRound: Mapped[str] = mapped_column(String, nullable=False)
    player1ID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)
    player2ID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)
    winnerID: Mapped[int | None] = mapped_column(Integer, ForeignKey("player.id"), nullable=True)
    vodFilename: Mapped[str | None] = mapped_column(String, nullable=True)
    vodTimestampStart: Mapped[float | None] = mapped_column(Float, nullable=True)
    vodTimestampEnd: Mapped[float | None] = mapped_column(Float, nullable=True)
    games: Mapped[list["Game"]] = db.relationship("Game", backref="match_set", lazy=True)

class Game(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    setID: Mapped[int] = mapped_column(Integer, ForeignKey("match_set.id"), nullable=False)
    gameNumber: Mapped[int] = mapped_column(Integer, nullable=False)
    player1Char: Mapped[str | None] = mapped_column(String, nullable=True)
    player2Char: Mapped[str | None] = mapped_column(String, nullable=True)
    winnerID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)

