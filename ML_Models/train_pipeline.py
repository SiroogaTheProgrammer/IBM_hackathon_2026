import os
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler

class InteractionAutoencoder(nn.Module):
    def __init__(self, input_dim):
        super(InteractionAutoencoder, self).__init__()
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

def preprocess_user_data(df: pd.DataFrame):
    # Ensure expected columns exist
    expected_cols = ['record timestamp', 'client timestamp', 'button', 'state', 'x', 'y']
    for col in expected_cols:
        if col not in df.columns:
            raise ValueError(f"Missing expected column: {col}")
            
    df['record timestamp'] = pd.to_numeric(df['record timestamp'])
    df['time_delta'] = df['record timestamp'].diff().fillna(0)
    
    # One-hot encode categorical variables
    df_encoded = pd.get_dummies(df, columns=['button', 'state'])
    feature_cols = [c for c in df_encoded.columns if c not in ['record timestamp', 'client timestamp']]
    
    data = df_encoded[feature_cols].values.astype(np.float32)
    scaler = StandardScaler()
    scaled_data = scaler.fit_transform(data)
    return scaled_data

def train_autoencoder(user_id, data_matrix, epochs=50, batch_size=32):
    print(f"--- Training Autoencoder for User: {user_id} ---")
    tensor_data = torch.tensor(data_matrix)
    dataloader = DataLoader(TensorDataset(tensor_data), batch_size=batch_size, shuffle=True)
    
    input_dim = data_matrix.shape[1]
    model = InteractionAutoencoder(input_dim)
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
            
    os.makedirs("./ML_Models", exist_ok=True)
    model_path = f"./ML_Models/autoencoder_user_{user_id}.pth"
    torch.save(model.state_dict(), model_path)
    print(f"Model saved for user {user_id} at {model_path}\n")

if __name__ == "__main__":
    TRAINING_DIR = "./training_files"
    
    if os.path.exists(TRAINING_DIR):
        # Loop through each user folder inside training_files (e.g., user12, user15)[cite: 2]
        user_folders = os.listdir(TRAINING_DIR)
        
        for user_folder in user_folders:
            user_path = os.path.join(TRAINING_DIR, user_folder)
            
            if os.path.isdir(user_path):
                user_id = user_folder # e.g., 'user12'
                user_dfs = []
                
                # Read all CSV files inside the user's folder
                for file_name in os.listdir(user_path):
                    if file_name.endswith(".csv"):
                        file_path = os.path.join(user_path, file_name)
                        df = pd.read_csv(file_path)
                        user_dfs.append(df)
                
                if user_dfs:
                    # Combine multiple CSVs if the user has more than one file
                    combined_df = pd.concat(user_dfs, ignore_index=True)
                    processed_data = preprocess_user_data(combined_df)
                    train_autoencoder(user_id, processed_data)
                else:
                    print(f"No CSV files found in folder for {user_id}.")
        
        print("Training complete! All user models are stored in ./ML_Models")
    else:
        print(f"Directory '{TRAINING_DIR}' does not exist.")