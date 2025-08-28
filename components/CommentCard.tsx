import React, { useRef, useEffect, useMemo, useState } from 'react';
import type { Comment, User } from '../types';
import Icon from './Icon';
import Waveform from './Waveform';
import TaggedContent from './TaggedContent';

const AVAILABLE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

interface CommentCardProps {
  comment: Comment;
  currentUser: User;
  isPlaying: boolean;
  onPlayPause: () => void;
  onAuthorClick: (username: string) => void;
  onReply: (comment: Comment) => void;
  onReact: (commentId: string, emoji: string) => void;
}

const TimeAgo: React.FC<{ date: string }> = ({ date }) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return <>Just now</>;
    let interval = seconds / 31536000;
    if (interval > 1) return <>{Math.floor(interval)}y</>;
    interval = seconds / 2592000;
    if (interval > 1) return <>{Math.floor(interval)}mo</>;
    interval = seconds / 86400;
    if (interval > 1) return <>{Math.floor(interval)}d</>;
    interval = seconds / 3600;
    if (interval > 1) return <>{Math.floor(interval)}h</>;
    interval = seconds / 60;
    if (interval > 1) return <>{Math.floor(interval)}m</>;
    return <>{Math.floor(seconds)}s</>;
};

const CommentCard: React.FC<CommentCardProps> = ({ comment, currentUser, isPlaying, onPlayPause, onAuthorClick, onReply, onReact }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const pickerTimeout = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        if (isPlaying) {
            audioElement.play().catch(e => console.error("Comment audio playback error:", e));
        } else {
            audioElement.pause();
        }
    }
  }, [isPlaying]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        const handleEnded = () => {
            if (!audioElement.paused) {
                onPlayPause();
            }
        };
        audioElement.addEventListener('ended', handleEnded);
        return () => {
            audioElement.removeEventListener('ended', handleEnded);
        }
    }
  }, [onPlayPause]);

  const myReaction = useMemo(() => {
    if (!comment.reactions) return null;
    let reaction = null;
    for (const emoji in comment.reactions) {
        if (comment.reactions[emoji].includes(currentUser.id)) {
            reaction = emoji;
            break;
        }
    }
    return reaction;
  }, [currentUser.id, comment.reactions]);
  
  const reactionEntries = useMemo(() => 
    Object.entries(comment.reactions || {}).filter(([, userIds]) => userIds && userIds.length > 0), 
  [comment.reactions]);

  const handleReaction = (e: React.MouseEvent | React.TouchEvent, emoji: string) => {
      e.stopPropagation();
      onReact(comment.id, emoji);
      setPickerOpen(false);
  }

  const handleDefaultReact = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onReact(comment.id, myReaction || '👍');
    setPickerOpen(false);
  };
  
  const handleMouseEnter = () => {
    if (pickerTimeout.current) clearTimeout(pickerTimeout.current);
    setPickerOpen(true);
  };

  const handleMouseLeave = () => {
    pickerTimeout.current = window.setTimeout(() => {
        setPickerOpen(false);
    }, 500);
  };
  
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    longPressTimer.current = window.setTimeout(() => {
        setPickerOpen(true);
    }, 400);
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
    }
    if (!isPickerOpen) {
        handleDefaultReact(e);
    }
  };


  const renderContent = () => {
    switch(comment.type) {
        case 'text':
            return <p className="text-slate-200 mt-1 whitespace-pre-wrap"><TaggedContent text={comment.text || ''} onTagClick={onAuthorClick} /></p>;
        case 'image':
            return <img src={comment.imageUrl} alt="Comment image" className="mt-2 rounded-lg max-w-full h-auto max-h-60" />;
        case 'audio':
        default:
            return (
                <>
                    {comment.audioUrl && <audio ref={audioRef} src={comment.audioUrl} className="hidden" />}
                    <button 
                        onClick={onPlayPause}
                        aria-label={isPlaying ? 'Pause comment' : 'Play comment'}
                        className={`w-full h-12 mt-1 p-2 rounded-md flex items-center gap-3 text-white transition-colors ${isPlaying ? 'bg-sky-500/30' : 'bg-slate-600/50 hover:bg-slate-600'}`}
                    >
                        <Icon name={isPlaying ? 'pause' : 'play'} className="w-5 h-5 flex-shrink-0" />
                        <div className="h-full flex-grow">
                            <Waveform isPlaying={isPlaying} barCount={25} />
                        </div>
                        <span className="text-xs font-mono self-end pb-1">{comment.duration}s</span>
                    </button>
                </>
            );
    }
  };
  
  return (
    <div className="bg-slate-700/50 rounded-lg p-3 flex gap-3 items-start relative">
        <button onClick={() => onAuthorClick(comment.author.username)} className="flex-shrink-0 group">
            <img src={comment.author.avatarUrl} alt={comment.author.name} className="w-10 h-10 rounded-full transition-all group-hover:ring-2 group-hover:ring-sky-400" />
        </button>
        <div className="flex-grow">
            <div className="flex items-baseline gap-2">
                <button onClick={() => onAuthorClick(comment.author.username)} className="font-bold text-slate-200 hover:text-sky-300 transition-colors">{comment.author.name}</button>
                <span className="text-xs text-slate-400"><TimeAgo date={comment.createdAt} /></span>
            </div>
            {comment.replyTo && (
                <div className="text-xs text-slate-400 border-l-2 border-slate-500 pl-2 mt-1">
                    Replying to <strong>{comment.replyTo.authorName}</strong>: <em>"{comment.replyTo.contentSnippet}"</em>
                </div>
            )}
            {renderContent()}
            <div className="mt-2 flex items-center gap-4 text-xs font-semibold text-slate-400">
                 <div 
                    onMouseEnter={handleMouseEnter} 
                    onMouseLeave={handleMouseLeave}
                    className="relative"
                >
                    {isPickerOpen && (
                        <div 
                            onMouseEnter={handleMouseEnter} 
                            onMouseLeave={handleMouseLeave}
                            className="absolute bottom-full mb-2 bg-slate-900/90 backdrop-blur-sm border border-lime-500/20 rounded-full p-1.5 flex items-center gap-1 shadow-lg animate-fade-in-fast"
                        >
                            {AVAILABLE_REACTIONS.map(emoji => (
                                <button key={emoji} onClick={(e) => handleReaction(e, emoji)} className="text-2xl p-1 rounded-full hover:bg-slate-700/50 transition-transform hover:scale-125">
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                    <button 
                        onClick={handleDefaultReact} 
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`hover:text-white ${myReaction ? 'text-sky-400' : ''}`}
                    >
                        {myReaction ? 'Reacted' : 'React'}
                    </button>
                </div>
                <button onClick={() => onReply(comment)} className="hover:text-white">Reply</button>
            </div>
             {reactionEntries.length > 0 && (
                <div className="absolute -bottom-3 right-0 flex gap-1 bg-slate-700/50 p-0.5 rounded-full border border-slate-600/50">
                    {reactionEntries.map(([emoji, userIds]) => (
                        <button key={emoji} onClick={(e) => handleReaction(e, emoji)} className={`px-1.5 py-0.5 text-xs rounded-full flex items-center gap-1 transition-colors ${userIds.includes(currentUser.id) ? 'bg-sky-500/80 text-white' : 'bg-slate-600/80 text-slate-200 hover:bg-slate-500/80'}`}>
                            <span>{emoji}</span>
                            <span className="font-semibold">{userIds.length}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    </div>
  );
};

export default CommentCard;