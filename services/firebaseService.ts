// @ts-nocheck
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { User as FirebaseUser } from 'firebase/auth';

import { db, auth, storage } from './firebaseConfig';
import { User, Post, Comment, Message, ReplyInfo, Story, Group, Campaign, LiveAudioRoom, LiveVideoRoom, Report, Notification, Lead, Author } from '../types';
import { DEFAULT_AVATARS, DEFAULT_COVER_PHOTOS, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, SPONSOR_CPM_BDT } from '../constants';

const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;
const increment = firebase.firestore.FieldValue.increment;
const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
const Timestamp = firebase.firestore.Timestamp;

// A temporary, module-level variable to hold details during the signup transition.
let pendingSignupDetails: { fullName: string; username: string; } | null = null;

const generateUniqueUsername = async (fullName: string): Promise<string> => {
    let baseUsername = fullName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
    if (!baseUsername) {
        baseUsername = 'user';
    }

    let finalUsername = baseUsername;
    let attempts = 0;
    const maxAttempts = 10;

    while (await firebaseService.isUsernameTaken(finalUsername)) {
        if (attempts >= maxAttempts) {
            // Fallback for extreme cases
            finalUsername = `user${Date.now()}`;
            break;
        }
        finalUsername = `${baseUsername}${Math.floor(1000 + Math.random() * 9000)}`;
        attempts++;
    }
    return finalUsername;
};


// --- Helper Functions ---
const docToUser = (doc: firebase.firestore.DocumentSnapshot): User => {
    const data = doc.data();
    const user = {
        id: doc.id,
        ...data,
    } as User;
    
    // Convert Firestore Timestamps to ISO strings
    if (user.createdAt && user.createdAt instanceof firebase.firestore.Timestamp) {
        user.createdAt = user.createdAt.toDate().toISOString();
    }
    if (user.commentingSuspendedUntil && user.commentingSuspendedUntil instanceof firebase.firestore.Timestamp) {
        user.commentingSuspendedUntil = user.commentingSuspendedUntil.toDate().toISOString();
    }
    
    return user;
}

const docToPost = (doc: firebase.firestore.DocumentSnapshot): Post => {
    const data = doc.data() || {};
    // Ensure comments are processed correctly
    const comments = (data.comments || []).map((comment: any) => {
        const newComment = { ...comment };
        if (comment.createdAt && comment.createdAt instanceof firebase.firestore.Timestamp) {
            newComment.createdAt = comment.createdAt.toDate().toISOString();
        }
        return newComment;
    });

    return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        reactions: data.reactions || {},
        comments: comments, // use the processed comments
        commentCount: data.commentCount || 0,
    } as Post;
}

// --- New Cloudinary Upload Helper ---
const uploadMediaToCloudinary = async (file: File | Blob, fileName: string): Promise<{ url: string, type: 'image' | 'video' | 'raw' }> => {
    const formData = new FormData();
    formData.append('file', file, fileName);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    
    let resourceType = 'auto';
    if (file.type.startsWith('video')) resourceType = 'video';
    else if (file.type.startsWith('image')) resourceType = 'image';
    else if (file.type.startsWith('audio')) resourceType = 'video'; // Cloudinary treats audio as video for transformations/delivery
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Cloudinary upload error:', errorData);
        throw new Error('Failed to upload media to Cloudinary');
    }

    const data = await response.json();
    return { url: data.secure_url, type: data.resource_type };
};

// --- Ad Targeting Helper ---
const matchesTargeting = (campaign: Campaign, user: User): boolean => {
    if (!campaign.targeting) return true; // No targeting set, matches everyone
    const { location, gender, ageRange, interests } = campaign.targeting;

    // Location check
    if (location && user.currentCity && location.toLowerCase().trim() !== user.currentCity.toLowerCase().trim()) {
        return false;
    }

    // Gender check
    if (gender && gender !== 'All' && user.gender && gender !== user.gender) {
        return false;
    }

    // Age range check
    if (ageRange && user.age) {
        const [min, max] = ageRange.split('-').map(part => parseInt(part, 10));
        if (user.age < min || user.age > max) {
            return false;
        }
    }

    // Interests check (simple bio check)
    if (interests && interests.length > 0 && user.bio) {
        const userBioLower = user.bio.toLowerCase();
        const hasMatchingInterest = interests.some(interest => userBioLower.includes(interest.toLowerCase()));
        if (!hasMatchingInterest) {
            return false;
        }
    }

    return true;
};


// --- Service Definition ---
export const firebaseService = {
    // --- Authentication ---
    onAuthStateChanged: (callback: (result: { user: User | null; isNew: boolean }) => void) => {
        return auth.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
            if (firebaseUser) {
                const { creationTime, lastSignInTime } = firebaseUser.metadata;
                const isNewUser = !creationTime || !lastSignInTime || (new Date(lastSignInTime).getTime() - new Date(creationTime).getTime() < 5000);

                let userProfile = await firebaseService.getUserProfileById(firebaseUser.uid);

                if (isNewUser && !userProfile && pendingSignupDetails) {
                    const { fullName, username } = pendingSignupDetails;
                    pendingSignupDetails = null;

                    await firebaseUser.getIdToken(true);

                    const uniqueUsername = username;

                    const userRef = db.collection('users').doc(firebaseUser.uid);
                    const usernameRef = db.collection('usernames').doc(uniqueUsername);

                    const newUserProfileData = {
                        name: fullName,
                        name_lowercase: fullName.toLowerCase(),
                        username: uniqueUsername,
                        email: firebaseUser.email!.toLowerCase(),
                        avatarUrl: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                        bio: `Welcome to VoiceBook, I'm ${fullName.split(' ')[0]}!`,
                        coverPhotoUrl: DEFAULT_COVER_PHOTOS[Math.floor(Math.random() * DEFAULT_COVER_PHOTOS.length)],
                        privacySettings: { postVisibility: 'public', friendRequestPrivacy: 'everyone' },
                        notificationSettings: { likes: true, comments: true, friendRequests: true },
                        blockedUserIds: [],
                        voiceCoins: 100,
                        role: 'user',
                        isBanned: false,
                        friendIds: [],
                        pendingFriendRequests: [],
                        sentFriendRequests: [],
                        createdAt: serverTimestamp(),
                        lastActiveTimestamp: serverTimestamp(),
                    };

                    const batch = db.batch();
                    batch.set(userRef, newUserProfileData);
                    batch.set(usernameRef, { userId: firebaseUser.uid });
                    
                    try {
                        await batch.commit();
                        userProfile = await firebaseService.getUserProfileById(firebaseUser.uid);
                    } catch (error) {
                        console.error("CRITICAL: Failed to create user profile in Firestore after auth success.", error);
                        await auth.signOut();
                        callback({ user: null, isNew: false });
                        return;
                    }
                }
                
                if (userProfile && !userProfile.isDeactivated && !userProfile.isBanned) {
                    callback({ user: userProfile, isNew: isNewUser });
                } else {
                    console.error(`User profile not found or user is banned/deactivated. UID: ${firebaseUser.uid}. Signing out.`);
                    await auth.signOut();
                    callback({ user: null, isNew: false });
                }
            } else {
                callback({ user: null, isNew: false });
            }
        });
    },

    async signUpWithEmail(email: string, pass: string, fullName: string, username: string): Promise<boolean> {
        try {
            pendingSignupDetails = { fullName, username };
            await auth.createUserWithEmailAndPassword(email, pass);
            return true;
        } catch (error) {
            console.error("Sign up (Auth creation) error:", error);
            pendingSignupDetails = null;
            return false;
        }
    },

    async signInWithEmail(identifier: string, pass: string): Promise<void> {
        const lowerIdentifier = identifier.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let emailToSignIn: string;

        if (emailRegex.test(lowerIdentifier)) {
            emailToSignIn = lowerIdentifier;
        } else {
            try {
                const usernameDocRef = db.collection('usernames').doc(lowerIdentifier);
                const usernameDoc = await usernameDocRef.get();

                if (!usernameDoc.exists) {
                    throw new Error("Invalid details. Please check your username/email and password.");
                }

                const userId = usernameDoc.data()!.userId;
                const userProfile = await this.getUserProfileById(userId);

                if (!userProfile) {
                     throw new Error("User profile not found for this username.");
                }
                emailToSignIn = userProfile.email;

            } catch (error: any) {
                console.error("Firestore username lookup failed:", error);
                if (error.code === 'unavailable') {
                    throw new Error("You are offline. Please log in with your full email address, as usernames cannot be checked without a connection.");
                }
                throw new Error("Network error. Could not verify username.");
            }
        }

        try {
            await auth.signInWithEmailAndPassword(emailToSignIn, pass);
        } catch (authError) {
            console.error("Firebase Auth sign in error:", authError);
            throw new Error("Invalid details. Please check your username/email and password.");
        }
    },
    
    signOutUser: () => auth.signOut(),

    async isUsernameTaken(username: string): Promise<boolean> {
        const usernameDocRef = db.collection('usernames').doc(username.toLowerCase());
        const usernameDoc = await usernameDocRef.get();
        return usernameDoc.exists;
    },
    
    async getUserProfileById(uid: string): Promise<User | null> {
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (userDoc.exists) {
            return docToUser(userDoc);
        }
        return null;
    },

     async getUsersByIds(userIds: string[]): Promise<User[]> {
        if (userIds.length === 0) {
            return [];
        }
        const usersRef = db.collection('users');
        const userPromises: Promise<firebase.firestore.QuerySnapshot>[] = [];
        for (let i = 0; i < userIds.length; i += 10) {
            const chunk = userIds.slice(i, i + 10);
            userPromises.push(usersRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get());
        }
        
        const userSnapshots = await Promise.all(userPromises);
        const users: User[] = [];
        userSnapshots.forEach(snapshot => {
            snapshot.docs.forEach(doc => {
                users.push(docToUser(doc));
            });
        });
        
        return users;
    },


    // --- Friends ---
    listenToFriends(userId: string, callback: (friends: User[]) => void) {
        const userRef = db.collection('users').doc(userId);
        return userRef.onSnapshot(async (userDoc) => {
            if (userDoc.exists) {
                const friendIds = userDoc.data()!.friendIds || [];
                if (friendIds.length === 0) {
                    callback([]);
                    return;
                }
                const friendPromises = friendIds.map(id => this.getUserProfileById(id));
                const friends = (await Promise.all(friendPromises)).filter(f => f !== null) as User[];
                
                const friendsWithStatus = friends.map((friend, index) => ({
                    ...friend,
                    onlineStatus: index % 3 === 0 ? 'online' : 'offline',
                }));
                callback(friendsWithStatus);
            } else {
                callback([]);
            }
        });
    },

    // --- Posts ---
    listenToFeedPosts(currentUserId: string, callback: (posts: Post[]) => void) {
        const q = db.collection('posts').orderBy('createdAt', 'desc').limit(50);
        return q.onSnapshot((snapshot) => {
            const feedPosts = snapshot.docs.map(docToPost);
            const filtered = feedPosts.filter(p => p.author?.id === currentUserId || p.author?.privacySettings?.postVisibility === 'public');
            callback(filtered);
        });
    },

    listenToExplorePosts(currentUserId: string, callback: (posts: Post[]) => void) {
        const q = db.collection('posts')
            .where('author.privacySettings.postVisibility', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(50);
        return q.onSnapshot((snapshot) => {
            const explorePosts = snapshot.docs
                .map(docToPost)
                .filter(post => post.author.id !== currentUserId && !post.isSponsored); // Filter client-side
            callback(explorePosts);
        });
    },

    listenToReelsPosts(callback: (posts: Post[]) => void) {
        const q = db.collection('posts')
            .where('videoUrl', '!=', null)
            .orderBy('videoUrl')
            .orderBy('createdAt', 'desc')
            .limit(50);
        return q.onSnapshot((snapshot) => {
            const reelsPosts = snapshot.docs.map(docToPost);
            callback(reelsPosts);
        });
    },

    async createPost(
        postData: any,
        media: {
            mediaFile?: File | null;
            audioBlobUrl?: string | null;
            generatedImageBase64?: string | null;
        }
    ) {
        const { author: user, ...restOfPostData } = postData;
        
        const authorInfo: Author = {
            id: user.id,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            privacySettings: user.privacySettings,
        };

        const postToSave: any = {
            ...restOfPostData,
            author: authorInfo,
            createdAt: serverTimestamp(),
            reactions: {},
            commentCount: 0,
            comments: [],
        };

        const userId = user.id;

        if (media.mediaFile) {
            const { url, type } = await uploadMediaToCloudinary(media.mediaFile, `post_${userId}_${Date.now()}`);
            if (type === 'video') {
                postToSave.videoUrl = url;
            } else {
                postToSave.imageUrl = url;
            }
        }
        
        if (media.generatedImageBase64) {
            const blob = await fetch(media.generatedImageBase64).then(res => res.blob());
            const { url } = await uploadMediaToCloudinary(blob, `post_ai_${userId}_${Date.now()}.jpeg`);
            postToSave.imageUrl = url;
        }

        if (media.audioBlobUrl) {
            const audioBlob = await fetch(media.audioBlobUrl).then(r => r.blob());
            const { url } = await uploadMediaToCloudinary(audioBlob, `post_audio_${userId}_${Date.now()}.webm`);
            postToSave.audioUrl = url;
        }

        await db.collection('posts').add(postToSave);
    },

    async deletePost(postId: string, userId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (!postDoc.exists) {
                throw new Error("Post not found");
            }

            const postData = postDoc.data() as Post;

            if (postData.author.id !== userId) {
                console.error("Permission denied: User is not the author of the post.");
                return false;
            }

            await postRef.delete();
            return true;

        } catch (error) {
            console.error("Error deleting post:", error);
            return false;
        }
    },
    
    async reactToPost(postId: string, userId: string, newReaction: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post does not exist!";
    
                const postData = postDoc.data() as Post;
                const reactions = { ...(postData.reactions || {}) };
                
                const userPreviousReaction = reactions[userId];
    
                if (userPreviousReaction === newReaction) {
                    delete reactions[userId];
                } else {
                    reactions[userId] = newReaction;
                }
                
                transaction.update(postRef, { reactions });
            });
            return true;
        } catch (e) {
            console.error("Reaction transaction failed:", e);
            return false;
        }
    },
    
    async createComment(user: User, postId: string, data: { text?: string; imageFile?: File; audioBlob?: Blob; duration?: number; replyTo?: Comment['replyTo'] }): Promise<Comment | null> {
        if (user.commentingSuspendedUntil && new Date(user.commentingSuspendedUntil) > new Date()) {
            console.warn(`User ${user.id} is suspended from commenting.`);
            return null;
        }
    
        const postRef = db.collection('posts').doc(postId);
        const commentId = db.collection('posts').doc().id; // Generate ID once
    
        // This object is for the UI return value
        const commentForUI: any = {
            id: commentId,
            postId,
            author: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl },
            createdAt: new Date().toISOString(),
            reactions: {},
        };
    
        // This object is for Firestore, it must not contain 'undefined' fields
        const commentForFirestore: any = {
            id: commentId, // Store the ID
            postId,
            author: commentForUI.author,
            createdAt: serverTimestamp(),
            reactions: {},
        };
    
        if (data.replyTo && data.replyTo.commentId) { // Check for valid commentId
            commentForUI.replyTo = data.replyTo;
            commentForFirestore.replyTo = data.replyTo;
        } else if (data.replyTo) {
            console.warn("Attempted to reply to a comment without an ID. Skipping reply context.", data.replyTo);
        }
    
        if (data.audioBlob && data.duration) {
            commentForUI.type = 'audio';
            commentForUI.duration = data.duration;
            commentForFirestore.type = 'audio';
            commentForFirestore.duration = data.duration;
            const { url } = await uploadMediaToCloudinary(data.audioBlob, `comment_audio_${commentId}.webm`);
            commentForUI.audioUrl = url;
            commentForFirestore.audioUrl = url;
        } else if (data.imageFile) {
            commentForUI.type = 'image';
            commentForFirestore.type = 'image';
            const { url } = await uploadMediaToCloudinary(data.imageFile, `comment_image_${commentId}.jpeg`);
            commentForUI.imageUrl = url;
            commentForFirestore.imageUrl = url;
        } else if (data.text !== undefined) {
            commentForUI.type = 'text';
            commentForUI.text = data.text;
            commentForFirestore.type = 'text';
            commentForFirestore.text = data.text;
        } else {
            // No content was provided
             console.error("createComment called without any content (text, image, or audio).");
             return null;
        }
    
        try {
            await postRef.update({
                comments: arrayUnion(commentForFirestore),
                commentCount: increment(1),
            });
        } catch (error) {
            console.error("Failed to post comment:", error);
            return null;
        }
        
        return commentForUI as Comment;
    },

    async reactToComment(postId: string, commentId: string, userId: string, emoji: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw new Error("Post not found");
    
                const postData = postDoc.data() as Post;
                
                let wasCommentFound = false;
                // Create a new comments array with the updated comment
                const newComments = (postData.comments || []).map(c => {
                    if (c.id !== commentId) {
                        return c;
                    }
    
                    wasCommentFound = true;
                    // Deep copy reactions to avoid mutation issues
                    const newReactions = JSON.parse(JSON.stringify(c.reactions || {}));
    
                    let userPreviousReaction: string | null = null;
                    // Find and remove previous reaction
                    for (const key in newReactions) {
                        const userIndex = newReactions[key].indexOf(userId);
                        if (userIndex > -1) {
                            userPreviousReaction = key;
                            newReactions[key] = newReactions[key].filter((id: string) => id !== userId);
                            break;
                        }
                    }
    
                    // If user is adding a new reaction or changing reaction
                    if (userPreviousReaction !== emoji) {
                        if (!newReactions[emoji]) {
                            newReactions[emoji] = [];
                        }
                        newReactions[emoji].push(userId);
                    }
    
                    // Clean up empty reaction arrays
                    for (const key in newReactions) {
                        if (newReactions[key].length === 0) {
                            delete newReactions[key];
                        }
                    }
                    
                    return { ...c, reactions: newReactions };
                });
    
                if (!wasCommentFound) {
                    throw new Error(`Comment with ID ${commentId} not found in post ${postId}`);
                }
    
                transaction.update(postRef, { comments: newComments });
            });
            return true;
        } catch (error) {
            console.error("Failed to react to comment:", error);
            return false;
        }
    },

    async voteOnPoll(userId: string, postId: string, optionIndex: number): Promise<Post | null> {
        const postRef = db.collection('posts').doc(postId);
        try {
            let updatedPostData: Post | null = null;
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) {
                    throw "Post does not exist!";
                }
    
                const postData = postDoc.data() as Post;
                if (!postData.poll) {
                    throw "This post does not have a poll.";
                }
    
                const hasVoted = postData.poll.options.some(opt => opt.votedBy.includes(userId));
                if (hasVoted) {
                    updatedPostData = docToPost(postDoc);
                    return;
                }
    
                if (optionIndex < 0 || optionIndex >= postData.poll.options.length) {
                    throw "Invalid poll option index.";
                }
    
                const updatedOptions = postData.poll.options.map((option, index) => {
                    if (index === optionIndex) {
                        return {
                            ...option,
                            votes: option.votes + 1,
                            votedBy: [...option.votedBy, userId],
                        };
                    }
                    return option;
                });
    
                const updatedPoll = { ...postData.poll, options: updatedOptions };
                transaction.update(postRef, { poll: updatedPoll });
                
                updatedPostData = { ...docToPost(postDoc), poll: updatedPoll };
            });
            return updatedPostData;
        } catch (e) {
            console.error("Vote on poll transaction failed:", e);
            return null;
        }
    },

    async markBestAnswer(userId: string, postId: string, commentId: string): Promise<Post | null> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (!postDoc.exists) {
                throw "Post does not exist!";
            }
            const postData = postDoc.data() as Post;
    
            if (postData.author.id !== userId) {
                console.error("Permission denied. User is not the author.");
                return null;
            }
            
            const commentExists = postData.comments.some(c => c.id === commentId);
            if (!commentExists) {
                 throw "Comment does not exist on this post.";
            }
    
            await postRef.update({ bestAnswerId: commentId });
            
            const updatedPostDoc = await postRef.get();
            return docToPost(updatedPostDoc);
        } catch (e) {
            console.error("Marking best answer failed:", e);
            return null;
        }
    },

    async getUserProfile(username: string): Promise<User | null> {
        const q = db.collection('users').where('username', '==', username.toLowerCase()).limit(1);
        const userQuery = await q.get();
        if (!userQuery.empty) {
            return docToUser(userQuery.docs[0]);
        }
        return null;
    },

    async getPostsByUser(userId: string): Promise<Post[]> {
        const q = db.collection('posts').where('author.id', '==', userId).orderBy('createdAt', 'desc');
        const postQuery = await q.get();
        return postQuery.docs.map(docToPost);
    },
    
    async updateProfile(userId: string, updates: Partial<User>): Promise<void> {
        await db.collection('users').doc(userId).update(updates);
    },
    
    async updateProfilePicture(userId: string, base64Url: string, caption: string): Promise<{ updatedUser: User, newPost: Post } | null> {
        try {
            const userRef = db.collection('users').doc(userId);
            const postsRef = db.collection('posts');
    
            const blob = await fetch(base64Url).then(res => res.blob());
            const { url: newAvatarUrl } = await uploadMediaToCloudinary(blob, `avatar_${userId}_${Date.now()}.jpeg`);
    
            const userDoc = await userRef.get();
            if (!userDoc.exists) throw new Error("User not found");
            const user = docToUser(userDoc);
    
            const newPostData = {
                author: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl },
                caption: caption || `${user.name} updated their profile picture.`,
                createdAt: serverTimestamp(),
                postType: 'profile_picture_change',
                newPhotoUrl: newAvatarUrl,
                commentCount: 0,
                comments: [],
                reactions: {},
                status: 'approved',
            };
    
            const batch = db.batch();
            batch.update(userRef, { avatarUrl: newAvatarUrl });
            const newPostRef = postsRef.doc();
            batch.set(newPostRef, newPostData);
            await batch.commit();
            
            const updatedUser = { ...user, avatarUrl: newAvatarUrl };
            const newPostForUI = { 
                ...newPostData, 
                id: newPostRef.id, 
                createdAt: new Date().toISOString(),
                author: { ...newPostData.author, avatarUrl: newAvatarUrl }
            } as Post;
            
            return { updatedUser, newPost: newPostForUI };
        } catch (error) {
            console.error("Failed to update profile picture in Firebase:", error);
            return null;
        }
    },
    
    async updateCoverPhoto(userId: string, base64Url: string, caption: string): Promise<{ updatedUser: User, newPost: Post } | null> {
        try {
            const userRef = db.collection('users').doc(userId);
            const postsRef = db.collection('posts');
    
            const blob = await fetch(base64Url).then(res => res.blob());
            const { url: newCoverUrl } = await uploadMediaToCloudinary(blob, `cover_${userId}_${Date.now()}.jpeg`);
            
            const userDoc = await userRef.get();
            if (!userDoc.exists) throw new Error("User not found");
            const user = docToUser(userDoc);
            
            const newPostData = {
                author: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl },
                caption: caption || `${user.name} updated their cover photo.`,
                createdAt: serverTimestamp(),
                postType: 'cover_photo_change',
                newPhotoUrl: newCoverUrl,
                commentCount: 0,
                comments: [],
                reactions: {},
                status: 'approved',
            };
    
            const batch = db.batch();
            batch.update(userRef, { coverPhotoUrl: newCoverUrl });
            const newPostRef = postsRef.doc();
            batch.set(newPostRef, newPostData);
            await batch.commit();
    
            const updatedUser = { ...user, coverPhotoUrl: newCoverUrl };
            const newPostForUI = { ...newPostData, id: newPostRef.id, createdAt: new Date().toISOString() } as Post;
            
            return { updatedUser, newPost: newPostForUI };
        } catch (error) {
            console.error("Failed to update cover photo in Firebase:", error);
            return null;
        }
    },

    async searchUsers(query: string): Promise<User[]> {
        const lowerQuery = query.toLowerCase();
        const nameQuery = db.collection('users').where('name_lowercase', '>=', lowerQuery).where('name_lowercase', '<=', lowerQuery + '\uf8ff');
        const usernameQuery = db.collection('users').where('username', '>=', lowerQuery).where('username', '<=', lowerQuery + '\uf8ff');
        
        const [nameSnapshot, usernameSnapshot] = await Promise.all([nameQuery.get(), usernameQuery.get()]);
        
        const results = new Map<string, User>();
        nameSnapshot.docs.forEach(d => results.set(d.id, docToUser(d)));
        usernameSnapshot.docs.forEach(d => results.set(d.id, docToUser(d)));
        
        return Array.from(results.values());
    },

    async blockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        const currentUserRef = db.collection('users').doc(currentUserId);
        const targetUserRef = db.collection('users').doc(targetUserId);
        try {
            await db.runTransaction(async (transaction) => {
                transaction.update(currentUserRef, { blockedUserIds: arrayUnion(targetUserId) });
                transaction.update(targetUserRef, { blockedUserIds: arrayUnion(currentUserId) });
            });
            return true;
        } catch (error) {
            console.error("Failed to block user:", error);
            return false;
        }
    },

    async unblockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        const currentUserRef = db.collection('users').doc(currentUserId);
        const targetUserRef = db.collection('users').doc(targetUserId);
        try {
            await db.runTransaction(async (transaction) => {
                transaction.update(currentUserRef, { blockedUserIds: arrayRemove(targetUserId) });
                transaction.update(targetUserRef, { blockedUserIds: arrayRemove(currentUserId) });
            });
            return true;
        } catch (error) {
            console.error("Failed to unblock user:", error);
            return false;
        }
    },

    async deactivateAccount(userId: string): Promise<boolean> {
        const userRef = db.collection('users').doc(userId);
        try {
            await userRef.update({ isDeactivated: true });
            return true;
        } catch (error) {
            console.error("Failed to deactivate account:", error);
            return false;
        }
    },

    async updateVoiceCoins(userId: string, amount: number): Promise<boolean> {
        const userRef = db.collection('users').doc(userId);
        try {
            await userRef.update({
                voiceCoins: increment(amount)
            });
            return true;
        } catch (e) {
            console.error("Failed to update voice coins:", e);
            return false;
        }
    },
    
    listenToLiveAudioRooms(callback: (rooms: LiveAudioRoom[]) => void) {
        const q = db.collection('liveAudioRooms').where('status', '==', 'live');
        return q.onSnapshot((snapshot) => {
            const rooms = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as LiveAudioRoom;
            });
            callback(rooms);
        });
    },

    listenToLiveVideoRooms(callback: (rooms: LiveVideoRoom[]) => void) {
        const q = db.collection('liveVideoRooms').where('status', '==', 'live');
        return q.onSnapshot((snapshot) => {
            const rooms = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as LiveVideoRoom;
            });
            callback(rooms);
        });
    },

    listenToRoom(roomId: string, type: 'audio' | 'video', callback: (room: LiveAudioRoom | LiveVideoRoom | null) => void) {
        const collectionName = type === 'audio' ? 'liveAudioRooms' : 'liveVideoRooms';
        return db.collection(collectionName).doc(roomId).onSnapshot((d) => {
            if (d.exists) {
                const data = d.data();
                const roomData = { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                };
                callback(roomData as LiveAudioRoom | LiveVideoRoom);
            } else {
                callback(null);
            }
        });
    },

    listenToMessages(chatId: string, callback: (messages: Message[]) => void) {
        const q = db.collection('chats').doc(chatId).collection('messages').orderBy('createdAt', 'asc');
        return q.onSnapshot((snapshot) => {
            const messages = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as Message;
            });
            callback(messages);
        });
    },
    
    async sendMessage(chatId: string, message: Omit<Message, 'id' | 'createdAt'>) {
         const messageWithTimestamp = {
            ...message,
            createdAt: serverTimestamp(),
        };
        await db.collection('chats').doc(chatId).collection('messages').add(messageWithTimestamp);
    },

    async createStory(
        storyData: Omit<Story, 'id' | 'createdAt' | 'duration' | 'contentUrl' | 'viewedBy'>,
        mediaFile: File | null
    ): Promise<Story> {
        const storyToSave: any = {
            ...storyData,
            author: {
                id: storyData.author.id,
                name: storyData.author.name,
                avatarUrl: storyData.author.avatarUrl,
                username: storyData.author.username,
            },
            createdAt: serverTimestamp(),
            viewedBy: [],
        };
    
        let duration = 5;
    
        if (mediaFile) {
            const { url, type } = await uploadMediaToCloudinary(mediaFile, `story_${storyData.author.id}_${Date.now()}`);
            storyToSave.contentUrl = url;
            
            if (type === 'video') {
                duration = 15; 
            }
        } else if (storyData.contentUrl) {
             const isVideo = storyData.contentUrl.endsWith('.mp4');
             if (isVideo) duration = 15;
        }
        
        storyToSave.duration = duration;
    
        const docRef = await db.collection('stories').add(storyToSave);
        
        const createdStory: Story = {
            id: docRef.id,
            ...storyData,
            createdAt: new Date().toISOString(),
            duration: duration,
            contentUrl: storyToSave.contentUrl || storyData.contentUrl,
            viewedBy: [],
        };
        return createdStory;
    },

    async promoteGroupMember(groupId: string, userToPromote: User, newRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const fieldToUpdate = newRole === 'Admin' ? 'admins' : 'moderators';
        try {
            const userRefOnly = { id: userToPromote.id, name: userToPromote.name, avatarUrl: userToPromote.avatarUrl, username: userToPromote.username };
            await groupRef.update({
                [fieldToUpdate]: arrayUnion(userRefOnly)
            });
            if (newRole === 'Admin') {
                await groupRef.update({
                    moderators: arrayRemove(userRefOnly)
                });
            }
            return true;
        } catch (error) {
            console.error(`Failed to promote ${userToPromote.name} to ${newRole}:`, error);
            return false;
        }
    },

    async demoteGroupMember(groupId: string, userToDemote: User, oldRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const fieldToUpdate = oldRole === 'Admin' ? 'admins' : 'moderators';
        try {
             const userRefOnly = { id: userToDemote.id, name: userToDemote.name, avatarUrl: userToDemote.avatarUrl, username: userToDemote.username };
            await groupRef.update({
                [fieldToUpdate]: arrayRemove(userRefOnly)
            });
            return true;
        } catch (error) {
            console.error(`Failed to demote ${userToDemote.name}:`, error);
            return false;
        }
    },
    async getPostById(postId: string): Promise<Post | null> {
        const postDoc = await db.collection('posts').doc(postId).get();
        if (postDoc.exists) {
            return docToPost(postDoc);
        }
        return null;
    },
    async removeGroupMember(groupId: string, userToRemove: User): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            const userRefOnly = { id: userToRemove.id, name: userToRemove.name, avatarUrl: userToRemove.avatarUrl, username: userToRemove.username };
            await groupRef.update({
                members: arrayRemove(userRefOnly),
                admins: arrayRemove(userRefOnly),
                moderators: arrayRemove(userRefOnly),
                memberCount: increment(-1)
            });
            return true;
        } catch (error) {
            console.error(`Failed to remove ${userToRemove.name}:`, error);
            return false;
        }
    },
    async approvePost(postId: string): Promise<void> {
        await db.collection('posts').doc(postId).update({ status: 'approved' });
    },
    async rejectPost(postId: string): Promise<void> {
        await db.collection('posts').doc(postId).delete();
    },
     async approveJoinRequest(groupId: string, userId: string): Promise<void> {
        const groupRef = db.collection('groups').doc(groupId);
        const user = await this.getUserProfileById(userId);
        if (!user) return;
        
        const userRefOnly = { id: user.id, name: user.name, avatarUrl: user.avatarUrl, username: user.username };
        const requestRef = { user: userRefOnly, answers: [] }; // The specific answers don't matter for removal, just the user object

        await groupRef.update({
            members: arrayUnion(userRefOnly),
            joinRequests: arrayRemove(requestRef), // This might need to be more specific if answers are stored differently
            memberCount: increment(1)
        });
    },
    async rejectJoinRequest(groupId: string, userId: string): Promise<void> {
        // Similar to approve, find the specific request object to remove
         const groupRef = db.collection('groups').doc(groupId);
        const user = await this.getUserProfileById(userId);
        if (!user) return;
        
        const userRefOnly = { id: user.id, name: user.name, avatarUrl: user.avatarUrl, username: user.username };
        const requestRef = { user: userRefOnly, answers: [] };
        
        await groupRef.update({
            joinRequests: arrayRemove(requestRef)
        });
    },

    // All the other functions
    async sendSiteWideAnnouncement(message: string): Promise<boolean> {
        // In a real app, this should be a backend cloud function to avoid hitting client limits.
        try {
            const usersSnapshot = await db.collection('users').get();
            const batch = db.batch();
            usersSnapshot.docs.forEach(userDoc => {
                const user = docToUser(userDoc);
                const notifRef = db.collection('users').doc(user.id).collection('notifications').doc();
                batch.set(notifRef, {
                    type: 'admin_announcement',
                    user: { id: 'admin', name: 'VoiceBook Team', avatarUrl: 'https://i.imgur.com/8XRUh9s.png' }, // Generic admin user
                    message,
                    createdAt: serverTimestamp(),
                    read: false,
                });
            });
            await batch.commit();
            return true;
        } catch (error) {
            console.error("Failed to send site-wide announcement:", error);
            return false;
        }
    },
    async getUserDetailsForAdmin(userId: string) {
        const [userDoc, postsSnapshot, reportsSnapshot] = await Promise.all([
            db.collection('users').doc(userId).get(),
            db.collection('posts').where('author.id', '==', userId).orderBy('createdAt', 'desc').limit(20).get(),
            db.collection('reports').where('reportedUserId', '==', userId).get()
        ]);

        const user = userDoc.exists ? docToUser(userDoc) : null;
        const posts = postsSnapshot.docs.map(docToPost);
        const reports = reportsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Report));

        // Note: fetching all comments by a user is inefficient. This is a simplified approach.
        const allPostsSnapshot = await db.collection('posts').limit(100).get(); // Limit scan range
        const comments: CommentType[] = [];
        allPostsSnapshot.docs.forEach(doc => {
            const post = docToPost(doc);
            const userComments = post.comments.filter(c => c.author.id === userId);
            comments.push(...userComments);
        });
        
        return { user, posts, comments, reports };
    },
     async suspendUserPosting(userId: string, days: number): Promise<boolean> {
        const suspensionEndDate = new Date();
        suspensionEndDate.setDate(suspensionEndDate.getDate() + days);
        try {
            await db.collection('users').doc(userId).update({ postingSuspendedUntil: Timestamp.fromDate(suspensionEndDate) });
            return true;
        } catch (e) { return false; }
    },
    async liftUserPostingSuspension(userId: string): Promise<boolean> {
        try {
            await db.collection('users').doc(userId).update({ postingSuspendedUntil: null });
            return true;
        } catch (e) { return false; }
    },
    async verifyCampaignPayment(campaignId: string, adminId: string): Promise<boolean> {
        try {
            await db.collection('campaigns').doc(campaignId).update({
                paymentStatus: 'verified',
                paymentVerifiedBy: adminId,
                paymentVerifiedAt: serverTimestamp(),
            });
            return true;
        } catch (error) {
            console.error("Failed to verify payment:", error);
            return false;
        }
    },
    async getAllCampaignsForAdmin(): Promise<Campaign[]> {
        const snapshot = await db.collection('campaigns').orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
    }
};