const { ObjectId } = require('mongodb');

class User {
    constructor({ email, password, isActive = false, phone = null, country = null }) {
        this.email = email;
        this.password = password; // В реальном проекте пароль нужно хешировать!
        this.isActive = isActive; // подтверждён ли email
        this.phone = phone;       // номер телефона
        this.country = country;   // страна проживания
        this._id = new ObjectId(); // уникальный ID
    }
}

module.exports = User;