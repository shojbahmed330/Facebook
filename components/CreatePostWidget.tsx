import React from 'react';
import type { User } from '../types';
import Icon from './Icon';

interface CreatePostWidgetProps {
  user: User;
  onStartCreatePost: (props?: any) => void;
}

const CreatePostWidget: React.FC<CreatePostWidgetProps> = ({ user, onStartCreatePost }) => {
  return (
    <div className="bg-slate-800 border border-lime-500/20 shadow-lg shadow-lime-500/5 rounded-lg p-4 w-full max-w-lg mx-auto">
      <div className="flex items-center gap-4">
        <img src={user.avatarUrl} alt={user.name} className="w-12 h-12 rounded-full" />
        <button
          onClick={() => onStartCreatePost()}
          className="flex-grow text-left bg-slate-700 hover:bg-slate-600/70 rounded-full px-5 py-3 text-slate-400 transition-colors"
        >
          What's on your mind, {user.name.split(' ')[0]}?
        </button>
      </div>
      <div className="border-t border-slate-700 mt-4 pt-3 flex justify-around">
        <button onClick={() => onStartCreatePost({ startRecording: true })} className="flex items-center gap-2 text-slate-300 hover:bg-slate-700/50 px-4 py-2 rounded-lg transition-colors">
          <Icon name="mic" className="w-6 h-6 text-rose-500" />
          <span className="font-semibold">Voice</span>
        </button>
         <button onClick={() => onStartCreatePost({ selectMedia: 'image' })} className="flex items-center gap-2 text-slate-300 hover:bg-slate-700/50 px-4 py-2 rounded-lg transition-colors">
            <Icon name="photo" className="w-6 h-6 text-green-400"/> 
            <span className="font-semibold">Photo</span>
        </button>
         <button onClick={() => onStartCreatePost({ selectMedia: 'video' })} className="flex items-center gap-2 text-slate-300 hover:bg-slate-700/50 px-4 py-2 rounded-lg transition-colors">
            <Icon name="video-camera" className="w-6 h-6 text-sky-400"/> 
            <span className="font-semibold">Video</span>
        </button>
      </div>
    </div>
  );
};

export default CreatePostWidget;