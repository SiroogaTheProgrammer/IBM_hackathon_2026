import os
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler

# 1. Define the Autoencoder Architecture
class KeystrokeAutoencoder(nn.Module):
    def __init__(self, input_dim):
        super(KeystrokeAutoencoder, self).__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU()
        )
        self.decoder = nn.Sequential(
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, input_dim)
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded

# 2. Preprocessing Function for Keystroke Data Schema
def preprocess_keystroke_data(df: pd.DataFrame):
    """
    Transforms schema: PARTICIPANT_ID, TEST_SECTION_ID, SENTENCE, USER_INPUT, 
    KEYSTROKE_ID, PRESS_TIME, RELEASE_TIME, LETTER, KEYCODE
    into numerical behavioral features (Hold Time, Flight Time, Keycode, etc.)
    """
    # Calculate Key Hold Time (Duration the key was pressed)
    df['hold_time'] = df['RELEASE_TIME'] - df['PRESS_TIME']
    
    # Calculate Flight Time (Time elapsed between successive key presses)
    df['flight_time'] = df['PRESS_TIME'].diff().fillna(0)
    
    # Select numerical features for modeling
    feature_cols = ['KEYSTROKE_ID', 'PRESS_TIME', 'RELEASE_TIME', 'KEYCODE', 'hold_time', 'flight_time']
    
    # Filter only columns that exist in the dataframe
    existing_cols = [col for col in feature_cols if col in df.columns]
    
    data = df[existing_cols].values.astype(np.float32)
    
    # Handle any potential NaNs or infinite values safely
    data = np.nan_to_num(data)
    
    # Scale features
    scaler = StandardScaler()
    scaled_data = scaler.fit_transform(data)
    
    return scaled_data

# 3. Training Function for a Single Participant
def train_autoencoder(participant_id, data_matrix, epochs=50, batch_size=32):
    print(f"--- Training Keystroke Autoencoder for Participant: {participant_id} ---")
    
    tensor_data = torch.tensor(data_matrix)
    dataloader = DataLoader(TensorDataset(tensor_data), batch_size=batch_size, shuffle=True)
    
    input_dim = data_matrix.shape[1]
    model = KeystrokeAutoencoder(input_dim)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    model.train()
    for epoch in range(epochs):
        total_loss = 0
        for batch in dataloader:
            inputs = batch[0]
            outputs = model(inputs)
            loss = criterion(outputs, inputs)
            
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            
        if (epoch + 1) % 10 == 0:
            print(f"Epoch [{epoch+1}/{epochs}], Loss: {total_loss / len(dataloader):.4f}")
            
    # Save model weights to ML_Models directory
    os.makedirs("./ML_Models", exist_ok=True)
    model_path = f"./ML_Models/autoencoder_keystroke_{participant_id}.pth"
    torch.save(model.state_dict(), model_path)
    print(f"Model saved for participant {participant_id} at {model_path}\n")

# 4. Main Pipeline Runner
if __name__ == "__main__":
    KEYSTROKE_DIR = "./Keystrokes/files"
    
    if os.path.exists(KEYSTROKE_DIR):
        files = [f for f in os.listdir(KEYSTROKE_DIR) if f.endswith(".txt") or f.endswith(".csv")]
        
        if not files:
            print(f"No keystroke data files found in {KEYSTROKE_DIR}.")
        
        for file_name in files:
            file_path = os.path.join(KEYSTROKE_DIR, file_name)
            
            # Extract participant ID from filename (e.g., '100001' from '100001_keystrokes.txt')
            participant_id = file_name.split('_')[0]
            
            # Read file (handles both CSV and tab-separated text files gracefully)
            try:
                df = pd.read_csv(file_path, sep=None, engine='python')
            except Exception as e:
                print(f"Error reading {file_name}: {e}")
                continue
            
            if not df.empty:
                processed_data = preprocess_keystroke_data(df)
                train_autoencoder(participant_id, processed_data)
            else:
                print(f"File {file_name} is empty.")
                
        print("Keystroke training complete! All models are saved in ./ML_Models")
    else:
        print(f"Directory '{KEYSTROKE_DIR}' does not exist.")