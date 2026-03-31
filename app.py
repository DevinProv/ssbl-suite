from flask import Flask
from database import db

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///ssbl.db"
db.init_app(app)

with app.app_context():
    import models
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True)