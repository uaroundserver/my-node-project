if (!localStorage.getItem('userToken')) {
  window.location.href = 'login.html';
}
function logout() {
  localStorage.removeItem('userToken');
  window.location.href = 'login.html';
}