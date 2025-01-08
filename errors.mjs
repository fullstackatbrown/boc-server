class AuthError extends Error {
    constructor(message = 'User not logged in') { //Auth errors can, of course, be triggered for other reasons too
      super(message);
      this.name = 'AuthError';
    }
}

class NonexistenceError extends Error {
    constructor(message = 'Requested resource does not exist') {
      super(message);
      this.name = 'NonexistenceError';
    }
}

class InvalidDataError extends Error {
    constructor(message = 'Data sent either improperly formatted or doesn\'t match expected typing') {
      super(message);
      this.name = 'InvalidDataError';
    }
}

export default { AuthError, NonexistenceError, InvalidDataError };