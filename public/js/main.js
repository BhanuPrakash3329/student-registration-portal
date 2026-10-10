// Common Functions
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout request failed:', error);
    }
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

function calculateAge(dob) {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// Registration Form
const signupForm = document.getElementById('signup-form');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('name', document.getElementById('name').value);
        formData.append('email', document.getElementById('email').value);
        formData.append('password', document.getElementById('password').value);
        formData.append('dob', document.getElementById('dob').value);
        
        const gender = document.querySelector('input[name="gender"]:checked');
        formData.append('gender', gender ? gender.value : '');
        
        formData.append('qualification', document.getElementById('qualification').value);
        
        const interests = [];
        document.querySelectorAll('input[name="interests"]:checked').forEach(cb => interests.push(cb.value));
        formData.append('interests', interests.join(','));
        
        formData.append('class', document.getElementById('class').value);
        formData.append('subject', document.getElementById('subject').value);
        formData.append('marks', document.getElementById('marks').value);
        
        const aadharFile = document.getElementById('aadhar').files[0];
        if (aadharFile) {
            formData.append('aadhar', aadharFile);
        }

        try {
            const response = await fetch('/api/signup', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            
            if (!response.ok) {
                const errorMsg = document.getElementById('error-msg');
                errorMsg.innerText = result.error || "This email is already registered.";
                errorMsg.style.display = 'block';
                document.getElementById('success-msg').style.display = 'none';
            } else {
                document.getElementById('error-msg').style.display = 'none';
                const successMsg = document.getElementById('success-msg');
                successMsg.innerText = 'Registration successful! Redirecting to login...';
                successMsg.style.display = 'block';
                setTimeout(() => window.location.href = 'login.html', 2000);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Server error. Please try again.');
        }
    });
}

// Login Form
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await response.json();

            if (!response.ok) {
                const errorMsg = document.getElementById('error-msg');
                errorMsg.innerText = result.error;
                errorMsg.style.display = 'block';
            } else {
                if (result.user.role === 'admin') {
                    window.location.href = 'admin.html';
                } else {
                    window.location.href = 'student.html';
                }
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Server error. Please try again.');
        }
    });
}

async function forgotPassword() {
    const email = prompt("Enter your registered email address:");
    if (email) {
        try {
            const response = await fetch('/api/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const result = await response.json();
            if (!response.ok) {
                alert(result.error || 'Failed to start password reset.');
            } else if (result.resetUrl) {
                prompt('Local development reset link (expires in 30 minutes):', result.resetUrl);
            } else {
                alert(result.message || 'If the account exists, password-reset instructions have been sent.');
            }
        } catch (error) {
            alert('Server error.');
        }
    }
}

const resetPasswordForm = document.getElementById('reset-password-form');
if (resetPasswordForm) {
    resetPasswordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = document.getElementById('reset-message');
        const token = new URLSearchParams(window.location.search).get('token');
        const newPassword = document.getElementById('new-password').value;
        try {
            const response = await fetch('/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const result = await response.json();
            message.textContent = result.message || result.error;
            message.className = response.ok ? 'alert alert-success' : 'alert alert-danger';
            message.style.display = 'block';
            if (response.ok) setTimeout(() => window.location.href = 'login.html', 1800);
        } catch (error) {
            message.textContent = 'Could not reset the password. Please try again.';
            message.className = 'alert alert-danger';
            message.style.display = 'block';
        }
    });
}

// Student Dashboard
let currentStudentData = {};
async function loadStudentDashboard() {
    try {
        const response = await fetch('/api/me');
        const data = await response.json();
        if (response.ok) {
            if (data.role !== 'student') {
                window.location.href = 'login.html';
                return;
            }
            currentStudentData = data;
            document.getElementById('welcome-message').innerText = `Welcome, ${data.name} (User ID: #${data.id})`;
            document.getElementById('display-email').innerText = data.email;
            
            document.getElementById('name').value = data.name;
            document.getElementById('dob').value = data.dob;
            
            if (data.gender) {
                const genderRadio = document.querySelector(`input[name="gender"][value="${data.gender}"]`);
                if (genderRadio) genderRadio.checked = true;
            }
            
            document.getElementById('qualification').value = data.qualification;
            
            if (data.interests) {
                const interests = data.interests.split(',');
                interests.forEach(interest => {
                    const cb = document.querySelector(`input[name="interests"][value="${interest}"]`);
                    if (cb) cb.checked = true;
                });
            }
            
            document.getElementById('class').value = data.class;
            document.getElementById('subject').value = data.subject;
            document.getElementById('marks').value = data.marks;
            
            const aadharLinkDiv = document.getElementById('current-aadhar-link');
            if (data.has_aadhar) {
                aadharLinkDiv.innerHTML = `<a href="/api/student/${encodeURIComponent(data.id)}/aadhar" target="_blank" rel="noopener">View Current Aadhaar (PDF)</a>`;
            } else {
                aadharLinkDiv.textContent = 'No Aadhaar PDF uploaded.';
            }
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function enableEdit() {
    document.getElementById('name').disabled = false;
    document.getElementById('dob').disabled = false;
    document.querySelectorAll('input[name="gender"]').forEach(el => el.disabled = false);
    document.getElementById('qualification').disabled = false;
    document.querySelectorAll('input[name="interests"]').forEach(el => el.disabled = false);
    document.getElementById('class').disabled = false;
    document.getElementById('subject').disabled = false;
    document.getElementById('marks').disabled = false;
    
    document.getElementById('aadhar-upload-div').style.display = 'block';
    document.getElementById('save-btn').style.display = 'block';
}

const studentProfileForm = document.getElementById('student-profile-form');
if (studentProfileForm) {
    studentProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentStudentData.id) return;
        
        const formData = new FormData();
        formData.append('name', document.getElementById('name').value);
        formData.append('dob', document.getElementById('dob').value);
        
        const gender = document.querySelector('input[name="gender"]:checked');
        formData.append('gender', gender ? gender.value : '');
        
        formData.append('qualification', document.getElementById('qualification').value);
        
        const interests = [];
        document.querySelectorAll('input[name="interests"]:checked').forEach(cb => interests.push(cb.value));
        formData.append('interests', interests.join(','));
        
        formData.append('class', document.getElementById('class').value);
        formData.append('subject', document.getElementById('subject').value);
        formData.append('marks', document.getElementById('marks').value);
        
        const aadharFile = document.getElementById('aadhar').files[0];
        if (aadharFile) {
            formData.append('aadhar', aadharFile);
        }

        try {
            const response = await fetch(`/api/student/${currentStudentData.id}`, {
                method: 'PUT',
                body: formData
            });
            const result = await response.json();
            
            if (response.ok) {
                const successMsg = document.getElementById('success-msg');
                successMsg.innerText = 'Profile updated successfully!';
                successMsg.style.display = 'block';
                setTimeout(() => location.reload(), 1500);
            } else {
                const errorMsg = document.getElementById('error-msg');
                errorMsg.innerText = result.error;
                errorMsg.style.display = 'block';
            }
        } catch (error) {
            console.error('Error updating profile:', error);
        }
    });
}

// Admin Dashboard
let allStudents = [];

async function loadAdminDashboard() {
    try {
        const response = await fetch('/api/admin/students');
        const data = await response.json();
        if (response.ok) {
            allStudents = data;
            renderStudents(allStudents);
        }
    } catch (error) {
        console.error('Error fetching students:', error);
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function renderStudents(students) {
    const tbody = document.querySelector('#students-table tbody');
    tbody.innerHTML = '';
    
    students.forEach(student => {
        const age = student.dob ? calculateAge(student.dob) : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${escapeHtml(student.id)}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(student.email)}</td>
            <td>${escapeHtml(age)} (${escapeHtml(student.dob || '')})</td>
            <td>${escapeHtml(student.class)}</td>
            <td>${student.has_aadhar ? `<a href="/api/admin/student/${encodeURIComponent(student.id)}/aadhar" target="_blank" rel="noopener">View PDF</a>` : 'Not uploaded'}</td>
            <td>
                <button class="btn btn-sm btn-primary edit-student">Edit</button>
                <button class="btn btn-sm btn-danger delete-student">Delete</button>
            </td>
        `;
        tr.querySelector('.edit-student').addEventListener('click', () => openEditModal(student));
        tr.querySelector('.delete-student').addEventListener('click', () => deleteStudent(student.id));
        tbody.appendChild(tr);
    });
}

function filterStudents() {
    const nameFilter = document.getElementById('filter-name').value.toLowerCase();
    const classFilter = document.getElementById('filter-class').value.toLowerCase();
    const minValue = document.getElementById('filter-age-min').value;
    const maxValue = document.getElementById('filter-age-max').value;
    const minAge = minValue === '' ? 0 : Number(minValue);
    const maxAge = maxValue === '' ? Infinity : Number(maxValue);

    const filtered = allStudents.filter(student => {
        const age = student.dob ? calculateAge(student.dob) : 0;
        const nameMatch = String(student.name || '').toLowerCase().includes(nameFilter);
        const classMatch = String(student.class || '').toLowerCase().includes(classFilter);
        const ageMatch = age >= minAge && age <= maxAge;
        
        return nameMatch && classMatch && ageMatch;
    });

    renderStudents(filtered);
}

let editModal;
function openEditModal(student) {
    document.getElementById('edit-id').value = student.id;
    document.getElementById('edit-name').innerText = student.name;
    document.getElementById('edit-email').innerText = student.email;
    document.getElementById('edit-dob').value = student.dob;
    document.getElementById('edit-gender').value = student.gender;
    document.getElementById('edit-qualification').value = student.qualification;
    document.querySelectorAll('input[name="edit-interests"]').forEach((checkbox) => {
        checkbox.checked = (student.interests || '').split(',').includes(checkbox.value);
    });
    document.getElementById('edit-class').value = student.class;
    document.getElementById('edit-subject').value = student.subject;
    document.getElementById('edit-marks').value = student.marks;
    
    if (!editModal) {
        editModal = new bootstrap.Modal(document.getElementById('editModal'));
    }
    editModal.show();
}

const adminEditForm = document.getElementById('admin-edit-form');
if (adminEditForm) {
    adminEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const data = {
            dob: document.getElementById('edit-dob').value,
            gender: document.getElementById('edit-gender').value,
            qualification: document.getElementById('edit-qualification').value,
            interests: Array.from(document.querySelectorAll('input[name="edit-interests"]:checked'))
                .map((checkbox) => checkbox.value).join(','),
            class: document.getElementById('edit-class').value,
            subject: document.getElementById('edit-subject').value,
            marks: document.getElementById('edit-marks').value
        };

        try {
            const response = await fetch(`/api/admin/student/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (response.ok) {
                editModal.hide();
                loadAdminDashboard();
            } else {
                alert('Failed to update student');
            }
        } catch (error) {
            console.error('Error updating student:', error);
        }
    });
}

async function deleteStudent(id) {
    if (confirm('Are you sure you want to delete this student?')) {
        try {
            const response = await fetch(`/api/admin/student/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                loadAdminDashboard();
            } else {
                alert('Failed to delete student');
            }
        } catch (error) {
            console.error('Error deleting student:', error);
        }
    }
}
