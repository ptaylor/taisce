export class AuthError extends Error {
  constructor(message = 'not authorised') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * The token works, but it was granted before a permission was added to the app.
 * Distinct from AuthError because there is nothing wrong with the session: the
 * fix is to authorise again with the wider permission, not to sign the user out.
 */
export class ScopeError extends Error {
  constructor(message = 'missing permission') {
    super(message);
    this.name = 'ScopeError';
  }
}
