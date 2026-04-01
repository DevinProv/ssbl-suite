from flask import Flask
from database import db
from routes import players_bp


app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///ssbl.db"
db.init_app(app)

app.register_blueprint(players_bp)

with app.app_context():
    import models # noqa F401: Models for DB
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True)
    
    

@app.route('/')
def index():
    return 'Index Page'
