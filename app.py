from flask import Flask, render_template
from database import db
from routes import players_bp, events_bp, sets_bp, characters_bp


app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///ssbl.db"
db.init_app(app)

app.register_blueprint(players_bp)
app.register_blueprint(events_bp)
app.register_blueprint(sets_bp)
app.register_blueprint(characters_bp)

@app.route("/")
def index():
    return render_template("dashboard/dashboard.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard/dashboard.html")



with app.app_context():
    import models # noqa F401: Models for DB
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0")
    
