import os
from huggingface_hub import snapshot_download

def download_models():
    # Base directory for models
    base_dir = os.path.join(os.getcwd(), "models", "qwen3_onnx")
    os.makedirs(base_dir, exist_ok=True)

    models = {
        "tts": "xkos/Qwen3-TTS-12Hz-1.7B-ONNX",
        "embedding": "marksverdhei/Qwen3-Voice-Embedding-12Hz-0.6B-onnx"
    }

    for name, repo_id in models.items():
        print(f"Downloading {name} model from {repo_id}...")
        target_dir = os.path.join(base_dir, name)
        os.makedirs(target_dir, exist_ok=True)
        
        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=target_dir,
                local_dir_use_symlinks=False
            )
            print(f"Successfully downloaded {name} to {target_dir}")
        except Exception as e:
            print(f"Error downloading {name}: {e}")

if __name__ == "__main__":
    download_models()
