import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { format, isToday } from 'date-fns';
import { useForm } from 'react-hook-form';
import toast, { Toaster } from 'react-hot-toast';
import { clsx } from 'clsx';
import { Plus, Check, Trash2, X, Sun, Moon, Sparkles, AlertCircle } from 'lucide-react';

 // ONLY lucide-react

// CRITICAL API RULE: The prompt states to import functions from `./api.js` and NOT
// to import `axios` directly in `App.jsx`. However, the "CRITICAL - SINGLE FILE ONLY" rule
// explicitly forbids `import ... from './'` or `import ... from '../'`.
// To resolve this direct conflict, the API logic using `axios` is defined locally
// within this `App.jsx` file as helper functions, effectively simulating `api.js`
// functionality while strictly adhering to the single-file constraint.
// The main `App` component then calls these locally defined helper functions.

// API Configuration
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// --- API Helper Functions (simulating src/api.js) ---
const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Generic error handler for API calls
const handleApiError = (error, defaultMessage = "An unexpected error occurred.") => {
    console.error("API Error:", error);
    let errorMessage = defaultMessage;
    if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        errorMessage = error.response.data?.detail || error.response.data?.message || error.message;
    } else if (error.request) {
        // The request was made but no response was received
        errorMessage = "No response from server. Please check your network connection.";
    } else {
        // Something happened in setting up the request that triggered an Error
        errorMessage = error.message;
    }
    toast.error(errorMessage);
};

// Fetches all habits with their daily completion status
const getHabits = async () => {
    try {
        const response = await api.get('/habits/');
        // CRITICAL DATA SAFETY: Parse API list responses safely
        return Array.isArray(response.data) ? response.data : (response.data?.items || []);
    } catch (error) {
        handleApiError(error, "Failed to fetch habits.");
        return [];
    }
};

// Creates a new habit
const createHabit = async (name) => {
    try {
        const response = await api.post('/habits/', { name });
        toast.success("Habit added successfully!");
        return response.data;
    } catch (error) {
        handleApiError(error, "Failed to add habit.");
        throw error; // Re-throw to allow component to handle form submission state
    }
};

// Toggles the completion status of a habit for the current day
const toggleHabitCompletion = async (habitId, isCompleted) => {
    try {
        const response = await api.post(`/habits/${habitId}/toggle_completion/`, { completed: isCompleted });
        toast.success(isCompleted ? "Habit marked as complete!" : "Habit marked as incomplete!");
        return response.data;
    } catch (error) {
        handleApiError(error, "Failed to update habit completion.");
        throw error;
    }
};

// Deletes a habit
const deleteHabit = async (habitId) => {
    try {
        await api.delete(`/habits/${habitId}/`);
        toast.success("Habit deleted successfully!");
    } catch (error) {
        handleApiError(error, "Failed to delete habit.");
        throw error;
    }
};
// --- End API Helper Functions ---


// Sub-component: Modal (defined inline)
const Modal = ({ isOpen, onClose, children, title }) => {
    if (!isOpen) return null;

    // A ref to the modal content for preventing clicks outside to close
    const modalRef = useRef();

    // Close modal if escape key is pressed
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black bg-opacity-70 backdrop-blur-sm" onClick={onClose}></div>
            <div
                ref={modalRef}
                className="relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-md mx-auto transform transition-all duration-300 scale-100 opacity-100"
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-300 text-white hover:scale-110"
                        aria-label="Close modal"
                    >
                        <X size={24} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

// Sub-component: MetricCard (defined inline)
const MetricCard = ({ title, value, icon, description }) => (
    <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl shadow-lg p-6 flex flex-col items-center text-center transition-all duration-300 hover:scale-105 hover:shadow-xl group">
        <div className="p-4 rounded-full bg-white/15 mb-4 group-hover:bg-white/20 transition-all duration-300">
            {icon}
        </div>
        <h4 className="text-xl font-semibold text-gray-200 mb-2 group-hover:text-white transition-all duration-300">{title}</h4>
        <p className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-400 group-hover:from-purple-400 group-hover:to-pink-500 transition-all duration-300">
            {value}
        </p>
        <p className="text-sm text-gray-400 mt-2">{description}</p>
    </div>
);

// Sub-component: HabitItem (defined inline)
const HabitItem = ({ habit, isCompletedToday, onToggleCompletion, onDelete }) => {
    return (
        <div className={clsx(
            "flex items-center justify-between p-4 rounded-xl border transition-all duration-300 ease-in-out",
            isCompletedToday
                ? "bg-green-700/20 border-green-600/30 text-gray-300 hover:bg-green-700/30"
                : "bg-white/5 border-white/10 text-gray-100 hover:bg-white/10",
            "hover:shadow-xl hover:-translate-y-1"
        )}>
            <div className="flex items-center flex-grow">
                <button
                    onClick={() => onToggleCompletion(habit.id, isCompletedToday)}
                    className={clsx(
                        "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 mr-4 transition-all duration-300",
                        isCompletedToday
                            ? "bg-green-500 border-green-500 text-white hover:scale-110"
                            : "bg-transparent border-purple-400 text-purple-400 hover:bg-purple-400 hover:text-white hover:scale-110"
                    )}
                    title={isCompletedToday ? "Mark as Incomplete" : "Mark as Complete"}
                    aria-label={isCompletedToday ? "Mark habit as incomplete" : "Mark habit as complete"}
                >
                    {isCompletedToday ? <Check size={20} /> : <Plus size={20} />}
                </button>
                <span className={clsx(
                    "text-xl font-medium",
                    isCompletedToday ? "line-through opacity-70 text-gray-400" : "text-white"
                )}>
                    {habit.name}
                </span>
            </div>
            <button
                onClick={() => onDelete(habit.id)}
                className="p-2 ml-4 rounded-full text-gray-400 hover:text-red-400 hover:bg-white/10 transition-all duration-300 hover:scale-110"
                title="Delete Habit"
                aria-label="Delete habit"
            >
                <Trash2 size={20} />
            </button>
        </div>
    );
};

// Sub-component: AddHabitForm (defined inline)
const AddHabitForm = ({ onSubmit }) => {
    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm();

    const onSubmitHandler = async (data) => {
        try {
            await onSubmit(data);
            reset(); // Clear form after successful submission
        } catch (error) {
            // Error handled by onSubmit (createHabit), no need to re-throw or reset here
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmitHandler)} className="space-y-6">
            <div>
                <label htmlFor="habitName" className="block text-gray-200 text-sm font-medium mb-2">
                    Habit Name
                </label>
                <input
                    id="habitName"
                    type="text"
                    {...register("name", { required: "Habit name is required", minLength: { value: 3, message: "Habit name must be at least 3 characters" } })}
                    className="w-full p-3 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 text-white placeholder-gray-400"
                    placeholder="e.g., Drink 8 glasses of water"
                    disabled={isSubmitting}
                />
                {errors.name && (
                    <p className="text-red-400 text-sm mt-2 flex items-center">
                        <AlertCircle size={16} className="inline mr-1" />{errors.name.message}
                    </p>
                )}
            </div>
            <button
                type="submit"
                className="w-full py-3 bg-gradient-to-br from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white font-bold rounded-lg shadow-md transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                disabled={isSubmitting}
            >
                {isSubmitting ? (
                    <>
                        <Sparkles className="animate-spin" size={20} /> Adding...
                    </>
                ) : (
                    <>
                        <Plus size={20} /> Add Habit
                    </>
                )}
            </button>
        </form>
    );
};


// Main App component
function App() {
    const navigate = useNavigate(); // CRITICAL ROUTING RULE: use useNavigate from react-router-dom
    const [habits, setHabits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode as per requirement

    const fetchHabits = useCallback(async () => {
        setLoading(true);
        const fetchedHabits = await getHabits();
        setHabits(fetchedHabits);
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchHabits();
    }, [fetchHabits]);

    const handleAddHabit = async (data) => {
        try {
            await createHabit(data.name);
            setIsAddModalOpen(false);
            fetchHabits(); // Refresh the list of habits
        } catch (error) {
            // Error handled by createHabit function, no need to re-throw here
        }
    };

    const handleToggleCompletion = async (habitId, currentStatus) => {
        try {
            await toggleHabitCompletion(habitId, !currentStatus);
            fetchHabits(); // Re-fetch to update state and UI
        } catch (error) {
            // Error handled by toggleHabitCompletion
        }
    };

    const handleDeleteHabit = async (habitId) => {
        if (window.confirm("Are you sure you want to delete this habit? This action cannot be undone.")) {
            try {
                await deleteHabit(habitId);
                fetchHabits(); // Re-fetch to update state and UI
            } catch (error) {
                // Error handled by deleteHabit
            }
        }
    };

    // Calculate daily stats for the hero section and metric cards
    const todayHabits = habits.filter(habit =>
        habit.daily_completions && habit.daily_completions.some(c => isToday(new Date(c.completion_date)))
    );
    const completedCount = todayHabits.length;
    const totalHabits = habits.length;
    const progressPercentage = totalHabits > 0 ? (completedCount / totalHabits) * 100 : 0;

    const todayDateFormatted = format(new Date(), "EEEE, MMMM do");

    return (
        <div className={clsx(
            "min-h-screen font-sans p-4 md:p-8 relative",
            isDarkMode
                ? "bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 text-gray-100"
                : "bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 text-gray-900 transition-colors duration-500"
        )}>
            <Toaster position="bottom-right" reverseOrder={false} />

            {/* Header / Top Navigation */}
            <header className="flex justify-between items-center mb-10 pb-4 border-b border-white/20">
                <div className="flex items-center space-x-3">
                    <Sparkles className="text-purple-400" size={36} />
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 leading-tight drop-shadow-lg">
                        Aura Habits
                    </h1>
                </div>
                <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-300 text-white hover:scale-110 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                >
                    {isDarkMode ? <Sun size={24} /> : <Moon size={24} className="text-gray-700" />}
                </button>
            </header>

            {/* Hero Section / Daily Overview */}
            <section className="mb-10 text-center bg-white/5 backdrop-blur-lg border border-white/20 rounded-2xl shadow-xl p-8 transform transition-all duration-500 hover:shadow-2xl">
                <p className="text-xl text-gray-300 mb-2">{todayDateFormatted}</p>
                <h2 className="text-5xl font-extrabold text-white mb-4 drop-shadow-lg">
                    {completedCount === totalHabits && totalHabits > 0 ? (
                        <span className="flex items-center justify-center gap-3">
                            <Sparkles className="text-green-400 animate-pulse" size={40} />All Habits Conquered!
                        </span>
                    ) : (
                        `Keep Going, You Got This!`
                    )}
                </h2>
                <div className="flex items-center justify-center gap-4 mt-6">
                    <div className="relative w-48 h-48">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle
                                className="text-white/20"
                                strokeWidth="16"
                                stroke="currentColor"
                                fill="transparent"
                                r="70"
                                cx="96"
                                cy="96"
                            />
                            <circle
                                className="text-green-500 transition-all duration-700 ease-out"
                                strokeWidth="16"
                                strokeDasharray={2 * Math.PI * 70}
                                strokeDashoffset={2 * Math.PI * 70 * (1 - progressPercentage / 100)}
                                strokeLinecap="round"
                                stroke="currentColor"
                                fill="transparent"
                                r="70"
                                cx="96"
                                cy="96"
                            />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-5xl font-bold text-white drop-shadow-lg">
                                {Math.round(progressPercentage)}%
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <MetricCard
                    title="Habits Today"
                    value={`${completedCount} / ${totalHabits}`}
                    icon={<Check size={28} className="text-green-400" />}
                    description="Completed for the day"
                />
                <MetricCard
                    title="Total Habits"
                    value={totalHabits}
                    icon={<Plus size={28} className="text-purple-400" />}
                    description="Your entire habit list"
                />
                <MetricCard
                    title="Unfinished"
                    value={totalHabits - completedCount}
                    icon={<X size={28} className="text-red-400" />}
                    description="Remaining for today"
                />
            </div>

            {/* Habit List Section */}
            <section className="max-w-3xl mx-auto">
                <h3 className="text-3xl font-bold text-white mb-6 text-center drop-shadow-md">Your Daily Rituals</h3>
                {loading ? (
                    <div className="text-center text-gray-400 text-lg p-8 bg-white/5 rounded-xl border border-white/10 shadow-lg flex items-center justify-center gap-2">
                        <Sparkles className="animate-pulse text-purple-400" size={24} /> Loading habits...
                    </div>
                ) : habits.length === 0 ? (
                    <div className="text-center text-gray-400 text-lg p-8 bg-white/5 rounded-xl border border-white/10 shadow-lg">
                        <p className="mb-4">No habits added yet. Let's create your first one!</p>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center mx-auto"
                            aria-label="Add your first habit"
                        >
                            <Plus size={20} className="mr-2" /> Add Your First Habit
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {habits.map((habit) => {
                            const isHabitCompletedToday = habit.daily_completions && habit.daily_completions.some(c => isToday(new Date(c.completion_date)));
                            return (
                                <HabitItem
                                    key={habit.id}
                                    habit={habit}
                                    isCompletedToday={isHabitCompletedToday}
                                    onToggleCompletion={handleToggleCompletion}
                                    onDelete={handleDeleteHabit}
                                />
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Add Habit Button (Floating Action Button style) */}
            <button
                onClick={() => setIsAddModalOpen(true)}
                className="fixed bottom-8 right-8 bg-gradient-to-br from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white p-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-4 focus:ring-purple-400 focus:ring-opacity-75"
                title="Add New Habit"
                aria-label="Add new habit"
            >
                <Plus size={32} />
            </button>

            {/* Add Habit Modal */}
            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add New Habit">
                <AddHabitForm onSubmit={handleAddHabit} />
            </Modal>
        </div>
    );
}

// Root component to wrap App with HashRouter
export default function Root() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<App />} />
                {/* Additional routes can be added here if the application expands,
                    but for a single-file App.jsx, keeping it minimal is key. */}
            </Routes>
        </Router>
    );
}