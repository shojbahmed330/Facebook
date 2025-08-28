import React, { useState, useEffect, useCallback } from 'react';
import { AuthMode, VoiceState } from '../types';
import { firebaseService } from '../services/firebaseService';
import Icon from './Icon';
import { getTtsPrompt } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import VoiceCommandInput from './VoiceCommandInput';
import { t } from '../i18n';

interface AuthScreenProps {
  ttsMessage: string;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onCommandProcessed: () => void;
  initialAuthError?: string;
  voiceState: VoiceState;
  onMicClick: () => void;
  onSendCommand: (command: string) => void;
  commandInputValue: string;
  setCommandInputValue: (value: string) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ 
  ttsMessage, onSetTtsMessage, lastCommand, onCommandProcessed, initialAuthError,
  voiceState, onMicClick, onSendCommand, commandInputValue, setCommandInputValue
}) => {
  const [mode, setMode] = useState<AuthMode>(AuthMode.LOGIN);
  
  // State for manual login form
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // State for voice-driven signup
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const { language } = useSettings();

  useEffect(() => {
    if (initialAuthError) {
        setAuthError(initialAuthError);
        onSetTtsMessage(initialAuthError);
    }
  }, [initialAuthError, onSetTtsMessage]);

  useEffect(() => {
    if (!initialAuthError) {
        onSetTtsMessage(getTtsPrompt('login_prompt_manual', language));
    }
    setMode(AuthMode.LOGIN); 
  }, [onSetTtsMessage, initialAuthError, language]);

  const resetSignupState = () => {
    setFullName('');
    setUsername('');
    setEmail('');
    setPassword('');
    setAuthError('');
  };

  const handleSignupInput = useCallback(async (text: string) => {
      setIsLoading(true);
      setAuthError('');
      const cleanedText = text.trim();

      try {
        switch(mode) {
            case AuthMode.SIGNUP_FULLNAME:
                setFullName(cleanedText);
                setMode(AuthMode.SIGNUP_USERNAME);
                onSetTtsMessage(getTtsPrompt('signup_username', language));
                break;
            case AuthMode.SIGNUP_USERNAME:
                const formattedUsername = cleanedText.toLowerCase().replace(/\s/g, '');
                const isTaken = await firebaseService.isUsernameTaken(formattedUsername);
                if(isTaken) {
                    onSetTtsMessage(getTtsPrompt('signup_username_invalid', language));
                    setAuthError(getTtsPrompt('signup_username_invalid', language));
                    break;
                }
                setUsername(formattedUsername);
                setMode(AuthMode.SIGNUP_EMAIL);
                onSetTtsMessage(getTtsPrompt('signup_email', language));
                break;
            case AuthMode.SIGNUP_EMAIL:
                 const formattedEmail = cleanedText.toLowerCase().replace(/\s/g, '');
                 if (!formattedEmail.includes('@') || !formattedEmail.includes('.')) {
                    onSetTtsMessage("Please provide a valid email address.");
                    setAuthError("Please provide a valid email address.");
                    break;
                 }
                 setEmail(formattedEmail);
                 setMode(AuthMode.SIGNUP_PASSWORD);
                 onSetTtsMessage(getTtsPrompt('signup_password', language));
                 break;
            case AuthMode.SIGNUP_PASSWORD:
                setPassword(cleanedText);
                setMode(AuthMode.SIGNUP_CONFIRM_PASSWORD);
                onSetTtsMessage(getTtsPrompt('signup_confirm_password', language));
                break;
            case AuthMode.SIGNUP_CONFIRM_PASSWORD:
                if (password !== cleanedText) {
                    onSetTtsMessage(getTtsPrompt('signup_password_mismatch', language));
                    setAuthError(getTtsPrompt('signup_password_mismatch', language));
                    setPassword('');
                    setMode(AuthMode.SIGNUP_PASSWORD);
                } else {
                    const success = await firebaseService.signUpWithEmail(email, password, fullName, username);
                    if (!success) {
                        setAuthError("Could not create account. The email might be in use.");
                        onSetTtsMessage("Could not create account. The email might be in use.");
                        resetSignupState();
                        setMode(AuthMode.LOGIN);
                    }
                }
                break;
        }
      } catch (error: any) {
          console.error("Auth error:", error);
          setAuthError(error.message || "An unexpected error occurred.");
          onSetTtsMessage(error.message || "An unexpected error occurred.");
      } finally {
          setIsLoading(false);
      }
  }, [mode, fullName, username, email, password, onSetTtsMessage, language]);
  
  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier || !loginPassword) {
        const errorMsg = "Please enter both email/username and password.";
        setAuthError(errorMsg);
        onSetTtsMessage(errorMsg);
        return;
    }
    setIsLoading(true);
    setAuthError('');
    try {
        await firebaseService.signInWithEmail(loginIdentifier, loginPassword);
        // onAuthStateChanged in UserApp will handle successful login
    } catch (error: any) {
        setAuthError(error.message || "An unexpected error occurred.");
        onSetTtsMessage(error.message || "An unexpected error occurred.");
    } finally {
        setIsLoading(false);
    }
};


  useEffect(() => {
    if (!lastCommand) return;
    
    const lowerCommand = lastCommand.toLowerCase();
    
    if (['log in', 'login', 'login koro'].includes(lowerCommand)) {
        setMode(AuthMode.LOGIN);
        onSetTtsMessage(getTtsPrompt('login_prompt_manual', language));
        resetSignupState();
    } else if (['sign up', 'signup', 'register'].includes(lowerCommand)) {
        setMode(AuthMode.SIGNUP_FULLNAME);
        onSetTtsMessage(getTtsPrompt('signup_fullname', language));
        resetSignupState();
    } else if (mode !== AuthMode.LOGIN) { // If we are in signup flow, process input
        handleSignupInput(lastCommand);
    }
    
    onCommandProcessed();
  }, [lastCommand, onCommandProcessed, mode, language, handleSignupInput, onSetTtsMessage]);
  
  const renderSignupProgress = () => {
    if (mode === AuthMode.LOGIN) return null;
    return (
        <div className="mt-4 text-left text-sm space-y-1">
           {fullName && <p className="text-slate-400">Full Name: <span className="text-slate-200">{fullName}</span></p>}
           {username && <p className="text-slate-400">Username: <span className="text-slate-200">@{username}</span></p>}
           {email && <p className="text-slate-400">Email: <span className="text-slate-200">{email}</span></p>}
           {password && <p className="text-slate-400">Password: <span className="text-slate-200">********</span></p>}
        </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col">
        <main className="flex-grow flex flex-col items-center justify-center text-center p-8 bg-slate-900 overflow-y-auto">
            <Icon name="logo" className="w-24 h-24 text-lime-400 mb-6 text-shadow-lg" />
            <h1 className="text-4xl font-bold mb-8 text-shadow-lg">VoiceBook</h1>
            
            <div className="bg-slate-800/50 border border-lime-500/20 rounded-lg p-6 w-full max-w-sm shadow-2xl shadow-lime-500/5">
                <p className={`font-medium text-lg min-h-[1.5em] flex items-center justify-center ${authError ? 'text-red-400' : 'text-sky-400'}`}>
                    {isLoading ? 'Processing...' : (authError || ttsMessage)}
                </p>

                {mode === AuthMode.LOGIN && (
                    <form onSubmit={handleManualLogin} className="mt-4 space-y-4">
                        <div>
                            <input
                                type="text"
                                value={loginIdentifier}
                                onChange={e => setLoginIdentifier(e.target.value)}
                                placeholder={t(language, 'auth.email_or_username_placeholder')}
                                required
                                className="w-full bg-slate-700 border border-slate-600 text-slate-100 rounded-lg p-3 focus:ring-lime-500 focus:border-lime-500 transition"
                            />
                        </div>
                        <div>
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={e => setLoginPassword(e.target.value)}
                                placeholder={t(language, 'auth.password_placeholder')}
                                required
                                className="w-full bg-slate-700 border border-slate-600 text-slate-100 rounded-lg p-3 focus:ring-lime-500 focus:border-lime-500 transition"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-lime-600 hover:bg-lime-500 disabled:bg-slate-600 text-black font-bold py-3 px-4 rounded-lg transition-colors text-lg"
                        >
                            {t(language, 'auth.login_button')}
                        </button>
                    </form>
                )}
                
                { (mode > AuthMode.LOGIN) && renderSignupProgress() }
            </div>
        </main>
        <footer className="flex-shrink-0">
            <VoiceCommandInput
                onSendCommand={onSendCommand}
                voiceState={voiceState}
                onMicClick={onMicClick}
                value={commandInputValue}
                onValueChange={setCommandInputValue}
                placeholder={ttsMessage || "Say 'login' or 'signup'"}
            />
        </footer>
    </div>
  );
};

export default AuthScreen;