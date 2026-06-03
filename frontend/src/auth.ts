/**
 * Cognito auth helpers using amazon-cognito-identity-js.
 * Env vars required at build time:
 *   VITE_COGNITO_USER_POOL_ID
 *   VITE_COGNITO_CLIENT_ID
 */

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
  ISignUpResult,
} from 'amazon-cognito-identity-js';

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string;

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: CLIENT_ID,
});

/** Sign in with email + password. */
export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: resolve,
      onFailure: reject,
      newPasswordRequired: () => reject(new Error('NEW_PASSWORD_REQUIRED')),
    });
  });
}

/** Register a new account. Returns the sign-up result (check userConfirmed). */
export function signUp(email: string, password: string): Promise<ISignUpResult> {
  return new Promise((resolve, reject) => {
    const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })];
    userPool.signUp(email, password, attrs, [], (err, result) => {
      if (err || !result) return reject(err ?? new Error('Sign-up failed'));
      resolve(result);
    });
  });
}

/** Confirm the registration code sent by email. */
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    cognitoUser.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Sign out the current user (clears localStorage tokens). */
export function signOut(): void {
  const user = userPool.getCurrentUser();
  if (user) user.signOut();
}

/** Get the current user's valid IdToken (refreshes automatically). */
export function getIdToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser();
    if (!user) return reject(new Error('No user session'));
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return reject(err ?? new Error('Invalid session'));
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

/** True if a valid session exists in localStorage. */
export function isAuthenticated(): Promise<boolean> {
  return getIdToken().then(() => true).catch(() => false);
}
