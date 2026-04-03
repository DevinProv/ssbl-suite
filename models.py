from sqlalchemy import Integer, String, ForeignKey, Float, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import db
from typing import Optional


class Player(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    defaultChar: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    defaultCharColor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    aliases: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)


class Event(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    eventTitle: Mapped[str] = mapped_column(String, nullable=False)
    eventDate: Mapped[str] = mapped_column(String, nullable=False)
    bracketLink: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    rounds: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    bracketSlug: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class Team(db.Model):
    """Ephemeral per-event doubles team."""
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    eventID: Mapped[int] = mapped_column(Integer, ForeignKey("event.id"), nullable=False)
    player1ID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)
    player2ID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)

    player1: Mapped["Player"] = relationship("Player", foreign_keys=[player1ID])
    player2: Mapped["Player"] = relationship("Player", foreign_keys=[player2ID])


class MatchSet(db.Model):
    __tablename__ = "match_set"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    eventID: Mapped[int] = mapped_column(Integer, ForeignKey("event.id"), nullable=False)
    bracketRound: Mapped[str] = mapped_column(String, nullable=False)
    mode: Mapped[str] = mapped_column(String, nullable=False, default="singles")
    # singles
    player1ID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("player.id"), nullable=True)
    player2ID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("player.id"), nullable=True)
    winnerID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("player.id"), nullable=True)
    # doubles
    team1ID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("team.id"), nullable=True)
    team2ID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("team.id"), nullable=True)
    winnerTeamID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("team.id"), nullable=True)
    # shared
    vodFilename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    vodTimestampStart: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vodTimestampEnd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    games: Mapped[list["Game"]] = relationship("Game", backref="match_set", lazy=True,
                                                cascade="all, delete-orphan")
    team1: Mapped[Optional["Team"]] = relationship("Team", foreign_keys=[team1ID])
    team2: Mapped[Optional["Team"]] = relationship("Team", foreign_keys=[team2ID])
    winner_team: Mapped[Optional["Team"]] = relationship("Team", foreign_keys=[winnerTeamID])


class Game(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    setID: Mapped[int] = mapped_column(Integer, ForeignKey("match_set.id"), nullable=False)
    gameNumber: Mapped[int] = mapped_column(Integer, nullable=False)

    participants: Mapped[list["GameParticipant"]] = relationship(
        "GameParticipant", backref="game", lazy=True, cascade="all, delete-orphan"
    )


class GameParticipant(db.Model):
    """One row per player per game.
    Singles: 2 rows per game.
    Doubles: 4 rows per game (2 per team), teamID links them to their side.
    FFA: 3-4 rows per game, all teamID null.
    """
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gameID: Mapped[int] = mapped_column(Integer, ForeignKey("game.id"), nullable=False)
    playerID: Mapped[int] = mapped_column(Integer, ForeignKey("player.id"), nullable=False)
    teamID: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("team.id"), nullable=True)
    character: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    isWinner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    player: Mapped["Player"] = relationship("Player", foreign_keys=[playerID])
    team: Mapped[Optional["Team"]] = relationship("Team", foreign_keys=[teamID])


class RoundTemplate(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    rounds: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    is_builtin: Mapped[bool] = mapped_column(db.Boolean, nullable=False, default=False)


class ClipExport(db.Model):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    setID: Mapped[int] = mapped_column(Integer, ForeignKey("match_set.id"), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    output_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    youtube_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    youtube_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)