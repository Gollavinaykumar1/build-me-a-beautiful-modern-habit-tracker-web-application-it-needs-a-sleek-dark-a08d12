# main.py
import os
from datetime import datetime, date, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Session, relationship
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, EmailStr
from jose import JWTError, jwt
from passlib.context import CryptContext

# CRITICAL RULE: Assume database.py exists and provides Base, engine, get_db
from database import Base, engine, get_db 

# --- Configuration ---
# In a production environment, these should be loaded from environment variables
# For local development, you can set them directly or via .env
SECRET_KEY = os.getenv("SECRET_KEY", "your-super-secret-key-please-change-this-in-production-it-is-not-secure")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours for convenience in a habit tracker

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for token authentication (used for token extraction from header)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

# --- FastAPI App Setup ---
app = FastAPI(
    title="Habit Tracker API",
    description="A sleek, modern backend for a Habit Tracker with robust features.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# CORS Middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    # In production, restrict this to your actual frontend domain(s)
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Models (SQLAlchemy) ---
# CRITICAL RULE: Use SQLAlchemy types inside Column()
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    habits = relationship("Habit", back_populates="owner", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}')>"

class Habit(Base):
    __tablename__ = "habits"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, index=True, nullable=False)
    description = Column(String, nullable=True) # Optional description
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True, nullable=False) # Soft delete mechanism

    owner = relationship("User", back_populates="habits")
    completions = relationship("DailyCompletion", back_populates="habit", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Habit(id={self.id}, name='{self.name}', user_id={self.user_id})>"

class DailyCompletion(Base):
    __tablename__ = "daily_completions"

    id = Column(Integer, primary_key=True, index=True)
    habit_id = Column(Integer, ForeignKey("habits.id"), nullable=False)
    completion_date = Column(Date, default=date.today, nullable=False) # The specific date this habit was completed
    created_at = Column(DateTime, default=datetime.utcnow) # Timestamp of when the completion record was created

    habit = relationship("Habit", back_populates="completions")

    # Ensure a habit can only be marked complete once per day by a unique constraint
    __table_args__ = (UniqueConstraint('habit_id', 'completion_date', name='_habit_date_uc'),)

    def __repr__(self):
        return f"<DailyCompletion(id={self.id}, habit_id={self.habit_id}, date={self.completion_date})>"

# Create all tables in the database on application startup if they don't exist.
# In a production environment, database migrations (e.g., using Alembic) are preferred
# to manage schema changes gracefully without data loss.
@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)


# --- Pydantic Schemas (for request/response validation and serialization) ---

# --- Authentication Schemas ---
class UserRegister(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    email: Optional[str] = None

# --- User Schemas ---
class UserResponse(BaseModel):
    id: int
    email: EmailStr
    created_at: datetime

    class Config:
        orm_mode = True # Enables Pydantic to read ORM objects

# --- Habit Schemas ---
class HabitBase(BaseModel):
    name: str
    description: Optional[str] = None

class HabitCreate(HabitBase):
    pass # Inherits name and description, no extra fields for creation

class HabitUpdate(HabitBase):
    is_active: Optional[bool] = None # Allow updating active status

class HabitResponse(HabitBase):
    id: int
    user_id: int
    created_at: datetime
    is_active: bool
    is_completed_today: bool = False # Field to inform frontend if habit is done for today

    class Config:
        orm_mode = True

# --- Daily Completion Schemas ---
class DailyCompletionResponse(BaseModel):
    id: int
    habit_id: int
    completion_date: date
    created_at: datetime

    class Config:
        orm_mode = True


# --- Security Utilities ---

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a hashed password."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hashes a plain password."""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Creates a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """
    Dependency to get the current authenticated user from a JWT token.
    Raises HTTPException if token is invalid or user not found.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.email == token_data.email).first()
    if user is None:
        raise credentials_exception
    return user


# --- API Routes ---

# CRITICAL ROOT ROUTE RULE:
@app.get("/")
def root():
    """Root endpoint to check API status."""
    return {"status": "running", "docs": "/api/docs"}

# CRITICAL HEALTH ROUTE RULE:
@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "healthy"}

# --- Authentication Endpoints ---
@app.post("/api/v1/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserRegister, db: Session = Depends(get_db)):
    """
    Registers a new user with email and password.
    CRITICAL AUTH RULE: Accepts JSON, not OAuth2PasswordRequestForm.
    """
    db_user = db.query(User).filter(User.email == user_data.email).first()
    if db_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    
    hashed_password = get_password_hash(user_data.password)
    new_user = User(email=user_data.email, hashed_password=hashed_password)
    
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
    except IntegrityError: # Catch any other potential DB errors during commit
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create user due to a database error.")
    
    return new_user

@app.post("/api/v1/auth/login", response_model=Token)
def login_for_access_token(user_data: UserLogin, db: Session = Depends(get_db)):
    """
    Logs in a user and returns a JWT access token.
    CRITICAL AUTH RULE: Accepts JSON, not OAuth2PasswordRequestForm.
    """
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/v1/users/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    """Retrieves the details of the currently authenticated user."""
    return current_user

# --- Habit Management Endpoints ---
@app.post("/api/v1/habits/", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(
    habit: HabitCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Creates a new habit for the authenticated user."""
    db_habit = Habit(
        name=habit.name,
        description=habit.description,
        user_id=current_user.id
    )
    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    # New habits are never completed on creation, so default is_completed_today to False
    return HabitResponse(**db_habit.__dict__, is_completed_today=False)

@app.get("/api/v1/habits/", response_model=List[HabitResponse])
def get_habits(
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves all active habits for the authenticated user,
    including their completion status for the current day.
    """
    habits = db.query(Habit).filter(
        Habit.user_id == current_user.id, 
        Habit.is_active == True
    ).order_by(Habit.created_at.asc()).all()
    
    today = date.today()
    habits_with_status = []
    for habit in habits:
        is_completed_today = db.query(DailyCompletion).filter(
            DailyCompletion.habit_id == habit.id,
            DailyCompletion.completion_date == today
        ).first() is not None
        
        # Use a dictionary comprehension to unpack habit's attributes, then add the extra field
        habit_dict = habit.__dict__.copy()
        habit_dict.pop('_sa_instance_state', None) # Remove SQLAlchemy internal state
        habits_with_status.append(HabitResponse(**habit_dict, is_completed_today=is_completed_today))
    
    return habits_with_status

@app.put("/api/v1/habits/{habit_id}", response_model=HabitResponse)
def update_habit(
    habit_id: int,
    habit_update: HabitUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Updates an existing habit for the authenticated user."""
    db_habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not db_habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found or not owned by user")

    # Update fields that are provided in the request
    if habit_update.name is not None:
        db_habit.name = habit_update.name
    if habit_update.description is not None:
        db_habit.description = habit_update.description
    if habit_update.is_active is not None:
        db_habit.is_active = habit_update.is_active
    
    db.commit()
    db.refresh(db_habit)

    # Check completion status for today to return in the response
    is_completed_today = db.query(DailyCompletion).filter(
        DailyCompletion.habit_id == db_habit.id,
        DailyCompletion.completion_date == date.today()
    ).first() is not None
    
    habit_dict = db_habit.__dict__.copy()
    habit_dict.pop('_sa_instance_state', None)
    return HabitResponse(**habit_dict, is_completed_today=is_completed_today)

@app.delete("/api/v1/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(
    habit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Deactivates (soft deletes) a habit for the authenticated user.
    Completions are retained for historical purposes but the habit won't appear in lists.
    """
    db_habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not db_habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found or not owned by user")

    db_habit.is_active = False # Soft delete
    db.commit()
    return

# --- Habit Completion Endpoints ---
@app.post("/api/v1/habits/{habit_id}/complete", response_model=DailyCompletionResponse, status_code=status.HTTP_201_CREATED)
def mark_habit_complete(
    habit_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Marks a specific habit as completed for the current day."""
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id, Habit.is_active == True).first()
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found, not owned by user, or inactive")
    
    today = date.today()
    existing_completion = db.query(DailyCompletion).filter(
        DailyCompletion.habit_id == habit_id,
        DailyCompletion.completion_date == today
    ).first()
    
    if existing_completion:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Habit already marked complete for today")
    
    new_completion = DailyCompletion(habit_id=habit_id, completion_date=today)
    db.add(new_completion)
    try:
        db.commit()
        db.refresh(new_completion)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not mark habit complete due to a database error.")
    
    return new_completion

@app.post("/api/v1/habits/{habit_id}/uncomplete", status_code=status.HTTP_204_NO_CONTENT)
def unmark_habit_complete(
    habit_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Removes the completion status for a specific habit for the current day."""
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id, Habit.is_active == True).first()
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found, not owned by user, or inactive")

    today = date.today()
    completion = db.query(DailyCompletion).filter(
        DailyCompletion.habit_id == habit_id,
        DailyCompletion.completion_date == today
    ).first()

    if not completion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit was not marked complete for today")

    db.delete(completion)
    db.commit()
    return # No content to return for 204

@app.get("/api/v1/habits/{habit_id}/completions", response_model=List[DailyCompletionResponse])
def get_habit_completions(
    habit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    days_back: int = 30 # Default to retrieving completions for the last 30 days
):
    """
    Retrieves the completion history for a specific habit for a given number of days.
    """
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found or not owned by user")

    start_date = date.today() - timedelta(days=days_back - 1) # Include today in the range
    completions = db.query(DailyCompletion).filter(
        DailyCompletion.habit_id == habit_id,
        DailyCompletion.completion_date >= start_date,
        DailyCompletion.completion_date <= date.today()
    ).order_by(DailyCompletion.completion_date.desc()).all()

    return completions